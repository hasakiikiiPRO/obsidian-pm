import { ButtonComponent, ItemView, WorkspaceLeaf, Menu, setIcon } from 'obsidian'
import type PMPlugin from '../main'
import type { GanttGranularity, Project, StatusConfig, Task, TaskSortMode } from '../types'
import { flattenTasks } from '../store/TaskTreeOps'
import { getPriorityConfig, getStatusConfig, sortTaskTree, svgEl } from '../utils'
import { parsePlainDate, today } from '../dates'
import { t } from '../i18n'
import { openTaskModal } from '../ui/ModalFactory'
import { EmptyState } from '../ui/primitives/EmptyState'
import { SegmentedControl } from '../ui/primitives/SegmentedControl'
import { PRIORITY_CHEVRONS, renderStatusDot } from '../ui/StatusBadge'
import {
  BAR_BORDER_RADIUS,
  BAR_PADDING,
  HEADER_HEIGHT,
  LABEL_WIDTH,
  ROW_HEIGHT,
  buildTimelineConfig,
  dateToX,
  type TimelineCfg
} from './gantt/TimelineConfig'
import { renderGridLines, renderTimelineHeader, renderTodayLine, type RendererContext } from './gantt/GanttRenderer'
import { makeDragState } from './gantt/GanttDragHandler'
import { makeLinkState } from './gantt/GanttLinkHandler'

export const PM_PORTFOLIO_TIMELINE_VIEW_TYPE = 'pm-portfolio-timeline'

/**
 * A read-only timeline of every project's tasks, grouped by project. Reuses the
 * single-project Gantt header/grid/today rendering, but draws bars without the
 * drag/dependency interactions, so a task can only be opened (not rescheduled).
 */
export class PortfolioTimelineView extends ItemView {
  private plugin: PMPlugin
  private granularity: GanttGranularity
  private sortMode: TaskSortMode = 'default'
  private scrollEl: HTMLElement | null = null
  private cfg: TimelineCfg | null = null

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.granularity = plugin.settings.ganttGranularity
    this.navigation = false
  }

  getViewType(): string {
    return PM_PORTFOLIO_TIMELINE_VIEW_TYPE
  }

  getDisplayText(): string {
    return t('portfolio.title')
  }

  getIcon(): string {
    return 'chart-gantt'
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    this.contentEl.addClass('pm-root')
    void this.render()
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    this.contentEl.empty()
    return Promise.resolve()
  }

  private async render(): Promise<void> {
    const root = this.contentEl
    root.empty()
    root.addClass('pm-gantt-view')

    const projects = await this.plugin.store.loadAllProjects(this.plugin.settings.projectsFolder)
    if (projects.length === 0) {
      new EmptyState(root)
        .setIcon('\u{1F4CB}')
        .setTitle(t('portfolio.noProjects'))
        .setBody(t('dashboard.noProjectsBody'))
      return
    }

    this.renderControls(root)
    this.renderTimeline(root, projects)
  }

  private renderControls(root: HTMLElement): void {
    const bar = root.createDiv('pm-gantt-controls')
    const levels: GanttGranularity[] = ['day', 'week', 'month', 'quarter']
    const labels: Record<GanttGranularity, string> = {
      day: t('granularity.day'),
      week: t('granularity.week'),
      month: t('granularity.month'),
      quarter: t('granularity.quarter')
    }

    new SegmentedControl<GanttGranularity>(bar, {
      options: levels.map((level) => ({ id: level, label: labels[level] })),
      active: this.granularity,
      onChange: (level) => {
        this.granularity = level
        this.plugin.settings.ganttGranularity = level
        void this.plugin.saveSettings()
        void this.render()
      }
    })

    bar.createSpan({ cls: 'pm-gantt-sep' })
    this.renderSortControl(bar)
    new ButtonComponent(bar).setButtonText(t('gantt.today')).onClick(() => this.scrollToToday())
  }

  private renderSortControl(bar: HTMLElement): void {
    const modes: TaskSortMode[] = ['default', 'priority', 'due']
    new ButtonComponent(bar)
      .setIcon('arrow-up-down')
      .setButtonText(t(`sort.${this.sortMode}`))
      .setTooltip(t('sort.title'))
      .onClick((e) => {
        const menu = new Menu()
        for (const mode of modes) {
          menu.addItem((item) =>
            item
              .setTitle(t(`sort.${mode}`))
              .setChecked(this.sortMode === mode)
              .onClick(() => {
                this.sortMode = mode
                void this.render()
              })
          )
        }
        menu.showAtMouseEvent(e)
      })
  }

  private renderTimeline(root: HTMLElement, projects: Project[]): void {
    const cfg = buildTimelineConfig(
      projects.flatMap((p) => p.tasks),
      this.granularity
    )
    this.cfg = cfg

    const wrapper = root.createDiv('pm-gantt-wrapper')

    const leftPanel = wrapper.createDiv('pm-gantt-left')
    leftPanel.style.width = `${LABEL_WIDTH}px`
    leftPanel.style.minWidth = `${LABEL_WIDTH}px`
    const leftHeader = leftPanel.createDiv('pm-gantt-left-header')
    leftHeader.style.height = `${HEADER_HEIGHT}px`
    leftHeader.createSpan({ text: t('gantt.task'), cls: 'pm-gantt-left-header-label' })
    const leftBody = leftPanel.createDiv('pm-gantt-left-body')

    const rightPanel = wrapper.createDiv('pm-gantt-right')
    this.scrollEl = rightPanel

    const headerSticky = rightPanel.createDiv('pm-gantt-header-sticky')
    headerSticky.style.width = `${cfg.totalWidth}px`
    headerSticky.style.height = `${HEADER_HEIGHT}px`
    const headerSvgEl = svgEl('svg', { width: cfg.totalWidth, height: HEADER_HEIGHT, class: 'pm-gantt-header-svg' })
    headerSticky.appendChild(headerSvgEl)

    const svgContainer = rightPanel.createDiv('pm-gantt-svg-container')
    svgContainer.style.width = `${cfg.totalWidth}px`
    svgContainer.style.marginTop = `-${HEADER_HEIGHT}px`

    const totalRows = this.countRows(projects)
    const svgHeight = HEADER_HEIGHT + totalRows * ROW_HEIGHT
    const svg = svgEl('svg', { width: cfg.totalWidth, height: svgHeight, class: 'pm-gantt-svg' })
    svgContainer.appendChild(svg)

    // Header/grid/today only read cfg + svg + plugin settings, so the project/status
    // fields below are placeholders to satisfy the shared RendererContext shape.
    const ctx: RendererContext = {
      svgEl: svg,
      headerSvgEl,
      cfg,
      plugin: this.plugin,
      project: projects[0],
      statuses: this.plugin.settings.statuses,
      flatTasks: [],
      drag: makeDragState(),
      link: makeLinkState(),
      onRefresh: async () => {},
      cleanupFns: []
    }

    renderTimelineHeader(ctx)
    renderGridLines(ctx, totalRows)
    renderTodayLine(ctx, svgHeight)

    this.renderRows(leftBody, svg, projects, cfg)

    const onLeftWheel = (e: WheelEvent) => {
      rightPanel.scrollTop += e.deltaY
      rightPanel.scrollLeft += e.deltaX
      e.preventDefault()
    }
    leftPanel.addEventListener('wheel', onLeftWheel, { passive: false })

    const spacer = leftBody.createDiv()
    spacer.addClass('pm-no-shrink')
    const syncSpacer = () => {
      spacer.style.height = `${rightPanel.offsetHeight - rightPanel.clientHeight}px`
    }
    rightPanel.addEventListener('scroll', () => {
      syncSpacer()
      leftBody.scrollTop = rightPanel.scrollTop
    })

    window.requestAnimationFrame(() => {
      syncSpacer()
      this.scrollToToday()
    })
  }

  private countRows(projects: Project[]): number {
    let n = 0
    for (const p of projects) n += 1 + flattenTasks(p.tasks).length
    return n
  }

  private renderRows(leftBody: HTMLElement, svg: SVGSVGElement, projects: Project[], cfg: TimelineCfg): void {
    const barsGroup = svgEl('g', { class: 'pm-gantt-bars' })
    svg.appendChild(barsGroup)

    let row = 0
    for (const project of projects) {
      this.renderProjectRow(leftBody, barsGroup, project, row, cfg)
      row++

      const config = this.plugin.store.configFor(project)
      const sorted = sortTaskTree(project.tasks, this.sortMode, config.priorities)
      for (const { task, depth } of flattenTasks(sorted)) {
        this.renderTaskLabelRow(leftBody, project, task, depth, config.statuses)
        this.renderReadonlyBar(barsGroup, project, task, row, cfg, config.statuses)
        row++
      }
    }
  }

  private renderProjectRow(
    leftBody: HTMLElement,
    barsGroup: SVGGElement,
    project: Project,
    row: number,
    cfg: TimelineCfg
  ): void {
    const el = leftBody.createDiv('pm-gantt-label-row pm-gantt-project-row')
    el.style.height = `${ROW_HEIGHT}px`
    el.createSpan({ text: project.icon, cls: 'pm-gantt-project-icon' })
    el.createSpan({ text: project.title, cls: 'pm-gantt-project-title' })

    barsGroup.appendChild(
      svgEl('rect', {
        x: 0,
        y: HEADER_HEIGHT + row * ROW_HEIGHT,
        width: cfg.totalWidth,
        height: ROW_HEIGHT,
        fill: project.color,
        opacity: 0.12,
        class: 'pm-gantt-project-band'
      })
    )
  }

  private renderTaskLabelRow(
    leftBody: HTMLElement,
    project: Project,
    task: Task,
    depth: number,
    statuses: StatusConfig[]
  ): void {
    const el = leftBody.createDiv('pm-gantt-label-row')
    el.style.height = `${ROW_HEIGHT}px`
    el.style.paddingLeft = `${depth * 18 + 8}px`
    renderStatusDot(el, task.status, statuses, 'pm-gantt-label-dot')
    const priorityConfig = getPriorityConfig(this.plugin.store.configFor(project).priorities, task.priority)
    const priorityEl = el.createSpan({ cls: 'pm-gantt-label-priority' })
    setIcon(priorityEl, PRIORITY_CHEVRONS[task.priority] ?? 'equal')
    if (priorityConfig?.color) priorityEl.style.color = priorityConfig.color
    const titleEl = el.createSpan({ text: task.title, cls: 'pm-gantt-label-title' })
    titleEl.addEventListener('click', () => {
      openTaskModal(this.plugin, project, { task, onSave: () => this.render() })
    })
    if (task.progress > 0) {
      el.createSpan({ text: `${task.progress}%`, cls: 'pm-gantt-label-progress' })
    }
  }

  private renderReadonlyBar(
    barsGroup: SVGGElement,
    project: Project,
    task: Task,
    row: number,
    cfg: TimelineCfg,
    statuses: StatusConfig[]
  ): void {
    const startDate = parsePlainDate(task.start)
    const endDate = parsePlainDate(task.due)
    if (!startDate && !endDate) return

    const statusConfig = getStatusConfig(statuses, task.status)
    const color = statusConfig?.color ?? project.color

    const rowY = HEADER_HEIGHT + row * ROW_HEIGHT
    barsGroup.appendChild(
      svgEl('rect', { x: 0, y: rowY, width: cfg.totalWidth, height: ROW_HEIGHT, class: 'pm-gantt-row-hover' })
    )

    if (task.type === 'milestone') {
      const date = startDate ?? endDate
      if (!date) return
      const cx = dateToX(cfg, date) + cfg.dayWidth / 2
      const cy = rowY + ROW_HEIGHT / 2
      const size = 12
      const pts = `${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`
      const diamond = svgEl('polygon', { points: pts, fill: color, class: 'pm-gantt-milestone', cursor: 'pointer' })
      diamond.addEventListener('click', () => {
        openTaskModal(this.plugin, project, { task, onSave: () => this.render() })
      })
      barsGroup.appendChild(diamond)
      return
    }

    const effectiveStart = startDate ?? endDate
    if (!effectiveStart) return
    const effectiveEnd = (endDate ?? effectiveStart).add({ days: 1 })

    const x = Math.max(0, dateToX(cfg, effectiveStart))
    const xEnd = Math.min(cfg.totalWidth, dateToX(cfg, effectiveEnd))
    const width = Math.max(8, xEnd - x)

    const y = rowY + BAR_PADDING
    const height = ROW_HEIGHT - BAR_PADDING * 2

    const barGroup = svgEl('g', { class: 'pm-gantt-bar-group' })
    barsGroup.appendChild(barGroup)

    const rect = svgEl('rect', {
      x,
      y,
      width,
      height,
      rx: BAR_BORDER_RADIUS,
      ry: BAR_BORDER_RADIUS,
      fill: color,
      opacity: 0.4,
      class: 'pm-gantt-bar'
    })
    barGroup.appendChild(rect)

    if (task.progress > 0) {
      barGroup.appendChild(
        svgEl('rect', {
          x,
          y,
          width: (task.progress / 100) * width,
          height,
          rx: BAR_BORDER_RADIUS,
          ry: BAR_BORDER_RADIUS,
          fill: color,
          opacity: 0.9,
          class: 'pm-gantt-bar-progress'
        })
      )
    }

    if (task.recurrence) {
      const icon = svgEl('text', { x: x + width + 4, y: y + height / 2 + 5, class: 'pm-gantt-bar-icon' })
      icon.textContent = 'R'
      barGroup.appendChild(icon)
    }

    if (width > 55) {
      const label = svgEl('text', { x: x + 8, y: y + height / 2 + 5, class: 'pm-gantt-bar-label' })
      const maxChars = Math.max(4, Math.floor((width - 16) / 7.5))
      label.textContent = task.title.length > maxChars ? task.title.slice(0, maxChars - 1) + '\u2026' : task.title
      barGroup.appendChild(label)
    }

    const ttEl = svgEl('title', {})
    const assigneesStr = task.assignees.length ? t('gantt.tipAssignees', { names: task.assignees.join(', ') }) : ''
    ttEl.textContent = t('gantt.tip', {
      title: task.title,
      status: statusConfig?.label ?? task.status,
      priority: task.priority,
      startLabel: t('gantt.tipStart'),
      dueLabel: t('gantt.tipDue'),
      progressLabel: t('gantt.tipProgress'),
      start: task.start || '\u2014',
      due: task.due || '\u2014',
      progress: task.progress,
      assignees: assigneesStr
    })
    rect.appendChild(ttEl)

    rect.addEventListener('click', () => {
      openTaskModal(this.plugin, project, { task, onSave: () => this.render() })
    })
  }

  private scrollToToday(): void {
    if (!this.scrollEl || !this.cfg) return
    const x = dateToX(this.cfg, today())
    this.scrollEl.scrollLeft = Math.max(0, x - this.scrollEl.clientWidth / 2)
  }
}
