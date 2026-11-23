const tabs = ['overview', 'internships', 'calendar', 'plans', 'reviews', 'notes', 'questions', 'ai-usage', 'progress', 'programs', 'assignments', 'members', 'notifications'];
const sections = ['tasks', 'plan', 'notes', 'activity'];
export function parseView(hash) {
    const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
    const params = new URLSearchParams(query);
    const [tab, internshipId, section, taskId] = path.split('/').filter(Boolean);
    if (!tabs.includes(tab))
        return { tab: 'overview' };
    if (tab === 'questions')
        return { tab, source: params.get('source') ?? undefined };
    if (tab !== 'internships')
        return { tab: tab };
    const programId = params.get('program') ?? undefined;
    if (!internshipId)
        return { tab, programId };
    if (section === 'tasks' && taskId) {
        const version = Number(params.get('v'));
        return { tab, internshipId, section: 'tasks', taskId, ...(version > 0 ? { version } : {}) };
    }
    return { tab, internshipId, section: sections.includes(section) ? section : 'tasks' };
}
export function formatView(view) {
    if (view.tab !== 'internships')
        return `#/${view.tab}`;
    if (!view.internshipId)
        return '#/internships' + (view.programId ? `?program=${view.programId}` : '');
    if (view.taskId)
        return `#/internships/${view.internshipId}/tasks/${view.taskId}` + (view.version ? `?v=${view.version}` : '');
    return `#/internships/${view.internshipId}/${view.section ?? 'tasks'}`;
}
