import logo from '../assets/brand/anchorzup-logo.svg'

/** Product name, used in the browser title and metadata. The visible brand is the company logo. */
export const PRODUCT = 'InternAgent'
export const COMPANY = 'AnchorzUp'

/** Official AnchorzUp logo. Height is fixed and width follows the file's own proportions. */
export function Brand({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`brand brand-${size}`}>
    <img className="brand-logo" src={logo} alt={COMPANY} draggable={false} />
  </span>
}
