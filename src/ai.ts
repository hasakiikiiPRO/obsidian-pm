import { requestUrl } from 'obsidian'
import type PMPlugin from './main'
import type { Project } from './types'
import { flattenTasks } from './store/TaskTreeOps'
import { isTerminalStatus } from './utils'
import { parsePlainDate, today } from './dates'

const SYSTEM_PROMPT = `你是一个项目管理助手。用户会提供他们所有项目的任务清单（含标题、所属项目、优先级、状态、截止日期、进度）。

请分析并输出：
1. **近期计划完成情况总结**：整体进度如何，各项目推进情况。
2. **行动建议**：现在应该优先做什么，结合截止日期临近程度与优先级给出一个清晰的先后顺序。
3. **风险提醒**：哪些任务已逾期、哪些快截止且优先级很高，需要重点关注。

要求：
- 用简体中文回答，简洁、分点、语气直接。
- 使用 Markdown 格式（列表、加粗）。
- 只依据用户提供的数据，不要编造不存在的任务或日期。
- 不要复述原始清单，要提炼出结论和建议。`

/** Builds a compact, structured task inventory for the model. */
function buildTaskContext(plugin: PMPlugin, projects: Project[]): string {
  const now = today()
  const lines: string[] = ['以下是当前所有项目的任务清单：', '']

  for (const project of projects) {
    const statuses = plugin.store.configFor(project).statuses
    lines.push(`## ${project.icon} ${project.title}`)
    const flat = flattenTasks(project.tasks)
    if (flat.length === 0) {
      lines.push('（无任务）')
      continue
    }
    for (const { task } of flat) {
      const done = isTerminalStatus(task.status, statuses)
      const due = parsePlainDate(task.due)
      const daysLeft = due ? due.since(now, { largestUnit: 'day' }).days : null
      const dueText =
        due === null
          ? '未设截止'
          : daysLeft === null
            ? task.due
            : `${task.due}（${daysLeft >= 0 ? `${daysLeft} 天后` : `已逾期 ${-daysLeft} 天`}）`
      const statusLabel =
        plugin.store.configFor(project).statuses.find((s) => s.id === task.status)?.label ?? task.status
      const priorityLabel =
        plugin.store.configFor(project).priorities.find((p) => p.id === task.priority)?.label ?? task.priority
      lines.push(
        `- [${done ? 'x' : ' '}] ${task.title} ｜ 优先级：${priorityLabel} ｜ 状态：${statusLabel} ｜ 截止：${dueText} ｜ 进度：${task.progress}%`
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

/** Normalizes a base URL to the chat completions endpoint. */
function chatCompletionsUrl(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '')
  if (b.endsWith('/chat/completions')) return b
  return `${b}/chat/completions`
}

export function isAiConfigured(plugin: PMPlugin): boolean {
  return plugin.settings.aiBaseUrl.trim().length > 0
}

export async function generatePlanSummary(plugin: PMPlugin, projects: Project[]): Promise<string> {
  const { aiBaseUrl, aiApiKey, aiModel } = plugin.settings
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (aiApiKey.trim()) headers.Authorization = `Bearer ${aiApiKey.trim()}`

  const response = await requestUrl({
    url: chatCompletionsUrl(aiBaseUrl),
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: aiModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildTaskContext(plugin, projects) }
      ],
      temperature: 0.3,
      stream: false
    })
  })

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${String(response.text).slice(0, 300)}`)
  }

  const data = response.json as { choices?: { message?: { content?: string } }[] }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 返回了空内容')
  }
  return content.trim()
}
