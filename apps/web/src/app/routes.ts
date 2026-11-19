export type Tab = 'overview' | 'internships' | 'calendar' | 'plans' | 'reviews' | 'notes' | 'questions'
  | 'ai-usage' | 'progress' | 'members' | 'programs' | 'assignments' | 'notifications'
export type InternshipSection = 'tasks' | 'plan' | 'notes' | 'activity'
/** Where the workspace is pointed. Kept in the URL hash so links, refresh and Back all work. */
export type View = {
  tab: Tab
  internshipId?: string
  section?: InternshipSection
  taskId?: string
  version?: number  // submission version to highlight on a task page
  programId?: string
  source?: string
}

const tabs: Tab[] = ['overview', 'internships', 'calendar', 'plans', 'reviews', 'notes', 'questions', 'ai-usage', 'progress', 'programs', 'assignments', 'members', 'notifications']
const sections: InternshipSection[] = ['tasks', 'plan', 'notes', 'activity']

export function parseView(hash: string): View {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const params = new URLSearchParams(query)
  const [tab, internshipId, section, taskId] = path.split('/').filter(Boolean)
  if (!tabs.includes(tab as Tab)) return { tab: 'overview' }
  if (tab === 'questions') return { tab, source: params.get('source') ?? undefined }
  if (tab !== 'internships') return { tab: tab as Tab }
  const programId = params.get('program') ?? undefined
  if (!internshipId) return { tab, programId }
  if (section === 'tasks' && taskId) {
    const version = Number(params.get('v'))
    return { tab, internshipId, section: 'tasks', taskId, ...(version > 0 ? { version } : {}) }
  }
  return { tab, internshipId, section: sections.includes(section as InternshipSection) ? section as InternshipSection : 'tasks' }
}

export function formatView(view: View): string {
  if (view.tab !== 'internships') return `#/${view.tab}`
  if (!view.internshipId) return '#/internships' + (view.programId ? `?program=${view.programId}` : '')
  if (view.taskId) return `#/internships/${view.internshipId}/tasks/${view.taskId}` + (view.version ? `?v=${view.version}` : '')
  return `#/internships/${view.internshipId}/${view.section ?? 'tasks'}`
}

