"""Read submission evidence without running code or forwarding credentials."""
import base64
import http.client
import ipaddress
import socket
import ssl
from html.parser import HTMLParser
from io import BytesIO
from pathlib import PurePath
from urllib.parse import urlsplit, urljoin
from zipfile import ZipFile

MAX_BYTES = 5 * 1024 * 1024
MAX_TEXT = 14000


class ReadError(Exception):
    pass


class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, value):
        if not self.hidden:
            self.parts.append(value)


def public_target(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
        raise ReadError("Unsupported URL")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if port not in (80, 443):
        raise ReadError("Unsupported port")
    addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
    ips = [item[4][0] for item in addresses]
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise ReadError("Private network links cannot be opened")
    return parsed, port, ips[0]


def fetch_public(url):
    for _ in range(4):
        parsed, port, ip = public_target(url)
        connection = http.client.HTTPConnection(parsed.hostname, port, timeout=5)
        try:
            sock = socket.create_connection((ip, port), timeout=5)
            if parsed.scheme == "https":
                import certifi
                context = ssl.create_default_context()
                context.load_verify_locations(cafile=certifi.where())
                sock = context.wrap_socket(sock, server_hostname=parsed.hostname)
            connection.sock = sock
            target = parsed.path or "/"
            if parsed.query:
                target += "?" + parsed.query
            connection.request("GET", target, headers={"User-Agent": "InternAgent-Evidence/1.0", "Accept-Encoding": "identity"})
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                if not location:
                    raise ReadError("Redirect has no destination")
                url = urljoin(url, location)
                continue
            if response.status != 200:
                raise ReadError("Page unavailable or requires sign-in")
            if response.getheader("Content-Encoding", "identity") != "identity":
                raise ReadError("Unsupported compressed page")
            length = response.getheader("Content-Length")
            if length and int(length) > MAX_BYTES:
                raise ReadError("Source exceeds the reading limit")
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ReadError("Source exceeds the reading limit")
            return data, response.getheader("Content-Type", "").split(";")[0]
        finally:
            connection.close()
    raise ReadError("Too many redirects")


def extract(data, mime, name):
    suffix = PurePath(name).suffix.lower()
    if mime.startswith("image/"):
        signatures = ((b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8\xff", "image/jpeg"),
                      (b"GIF8", "image/gif"))
        actual = next((kind for signature, kind in signatures if data.startswith(signature)), None)
        if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
            actual = "image/webp"
        if actual is None:
            raise ReadError("Unsupported or invalid image")
        return None, {"type": "image_url", "image_url": {"url": "data:" + actual + ";base64," + base64.b64encode(data).decode()}}
    if mime == "application/pdf" or suffix == ".pdf":
        from pypdf import PdfReader
        pdf = PdfReader(BytesIO(data))
        if pdf.is_encrypted or len(pdf.pages) > 30:
            raise ReadError("Encrypted PDF or more than 30 pages")
        text = "\n".join((page.extract_text() or "")[:MAX_TEXT] for page in pdf.pages[:30])
    elif suffix in (".docx", ".xlsx", ".pptx"):
        from defusedxml.ElementTree import fromstring
        with ZipFile(BytesIO(data)) as archive:
            entries = [item for item in archive.infolist() if item.filename.endswith(".xml")
                       and item.filename.startswith(("word/document", "ppt/slides/slide", "xl/sharedStrings", "xl/worksheets/sheet"))]
            if sum(item.file_size for item in entries) > 8 * 1024 * 1024 or len(entries) > 100:
                raise ReadError("Document exceeds the extraction limit")
            text = "\n".join(" ".join(fromstring(archive.read(item)).itertext()) for item in entries)
    elif mime == "text/html":
        parser = PageText()
        parser.feed(data.decode("utf-8", errors="replace"))
        text = " ".join(parser.parts)
    elif mime.startswith("text/") or mime == "application/json" or suffix in (".txt", ".md", ".csv", ".json"):
        text = data.decode("utf-8", errors="replace")
    else:
        raise ReadError("This file type needs manual review")
    text = " ".join(text.split())
    if not text:
        raise ReadError("No readable text; scanned documents need manual review")
    return text[:MAX_TEXT], None


def collect(files, links, storage, vision):
    records, images = [], []
    sources = [("file", row) for row in files] + [("link", row) for row in links]
    for index, (kind, row) in enumerate(sources):
        name = row["file_name"] if kind == "file" else (row["title"] or urlsplit(row["url"]).hostname or "Link")
        record = {"source": name, "kind": kind, "status": "unread", "detail": ""}
        try:
            if index >= 8:
                raise ReadError("Only the first 8 sources are read")
            if kind == "file":
                if storage is None or not hasattr(storage, "read"):
                    raise ReadError("File storage reader unavailable")
                if row["size_bytes"] > MAX_BYTES:
                    raise ReadError("File exceeds 5 MB reading limit")
                data = storage.read(row["storage_path"], MAX_BYTES)
                mime = row["content_type"]
                document_name = row["file_name"]
            else:
                data, mime = fetch_public(row["url"])
                document_name = urlsplit(row["url"]).path
            text, image = extract(data, mime, document_name)
            if image:
                if not vision:
                    raise ReadError("The configured review model cannot read images")
                if len(images) >= 3:
                    raise ReadError("Only the first 3 images are analyzed")
                images.extend([{"type": "text", "text": "Image source: " + name}, image])
                record.update(status="image", detail="Image provided to the review model")
            else:
                record.update(status="read", detail="Text excerpt read", content=text)
        except ReadError as error:
            record["detail"] = str(error)
        except (OSError, ValueError, http.client.HTTPException):
            record["detail"] = "Source could not be read. Open it manually."
        except Exception:
            record["detail"] = "Source could not be read. Open it manually."
        records.append(record)
    return records, images
