import { Menu } from 'obsidian'
import type { Project, FilterState, StatusConfig, PriorityConfig, DueDateFilter } from '../../../types'
import { collectAllAssignees, collectAllTags } from '../../../store'
import { countActiveFilters } from '../../../store/TaskFilter'
import { renderFilterDropdown } from '../../FilterDropdown'
import { ChipButton } from '../../primitives/ChipButton'
import { formatBadgeText } from '../../../utils'
import { t } from '../../../i18n'

export interface FilterRowProps {
  project: Project
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  filter: FilterState
  onFilterChange: () => void
  onClear: () => void
}

const dueLabels = (): Record<DueDateFilter, string> => ({
  any: t('filter.due.any'),
  overdue: t('filter.due.overdue'),
  'this-week': t('filter.due.thisWeek'),
  'this-month': t('filter.due.thisMonth'),
  'no-date': t('filter.due.noDate')
})

export class FilterRow {
  el: HTMLElement
  private clearBtn: ChipButton | null = null

  constructor(
    parentEl: HTMLElement,
    private props: FilterRowProps
  ) {
    this.el = parentEl.createDiv('pm-project-header-filter')
    this.render()
  }

  private render(): void {
    this.el.empty()
    const { filter, statuses, priorities, project } = this.props

    const notify = () => {
      this.props.onFilterChange()
      this.updateClearButton()
    }

    renderFilterDropdown(
      this.el,
      t('filter.status'),
      filter.statuses,
      statuses.map((s) => ({ id: s.id, label: formatBadgeText(s.icon, s.label) })),
      (selected) => {
        filter.statuses = selected
        notify()
      }
    )

    renderFilterDropdown(
      this.el,
      t('filter.priority'),
      filter.priorities,
      priorities.map((p) => ({ id: p.id, label: formatBadgeText(p.icon, p.label) })),
      (selected) => {
        filter.priorities = selected
        notify()
      }
    )

    const allAssignees = collectAllAssignees(project.tasks)
    if (allAssignees.length) {
      renderFilterDropdown(
        this.el,
        t('filter.assignee'),
        filter.assignees,
        allAssignees.map((a) => ({ id: a, label: a })),
        (selected) => {
          filter.assignees = selected
          notify()
        }
      )
    }

    const allTags = collectAllTags(project.tasks)
    if (allTags.length) {
      renderFilterDropdown(
        this.el,
        t('filter.tag'),
        filter.tags,
        allTags.map((t) => ({ id: t, label: t })),
        (selected) => {
          filter.tags = selected
          notify()
        }
      )
    }

    this.renderDueDateButton(notify)
    this.renderArchivedButton(notify)
    this.renderClearButton()
  }

  private renderDueDateButton(notify: () => void): void {
    const { filter } = this.props
    const btn = new ChipButton(this.el)
    const updateLabel = () => {
      const labels = dueLabels()
      const current = filter.dueDateFilter
      btn
        .setLabel(current !== 'any' ? t('filter.duePrefix', { label: labels[current] }) : labels.any)
        .setActive(current !== 'any')
    }
    updateLabel()
    btn.onClick((e) => {
      const menu = new Menu()
      const opts: DueDateFilter[] = ['any', 'overdue', 'this-week', 'this-month', 'no-date']
      const labels = dueLabels()
      for (const opt of opts) {
        menu.addItem((item) =>
          item
            .setTitle(labels[opt])
            .setChecked(filter.dueDateFilter === opt)
            .onClick(() => {
              filter.dueDateFilter = opt
              updateLabel()
              notify()
            })
        )
      }
      menu.showAtMouseEvent(e)
    })
  }

  private renderArchivedButton(notify: () => void): void {
    const { filter } = this.props
    const btn = new ChipButton(this.el).setLabel(t('filter.archived')).setActive(filter.showArchived)
    btn.onClick(() => {
      filter.showArchived = !filter.showArchived
      btn.setActive(filter.showArchived)
      notify()
    })
  }

  private renderClearButton(): void {
    const count = countActiveFilters(this.props.filter)
    if (count === 0) {
      this.clearBtn = null
      return
    }
    this.clearBtn = new ChipButton(this.el).setLabel(t('filter.clearCount', { count })).onClick(() => {
      this.props.onClear()
    })
  }

  refreshClearButton(): void {
    this.updateClearButton()
  }

  private updateClearButton(): void {
    if (this.clearBtn) {
      this.clearBtn.el.remove()
      this.clearBtn = null
    }
    this.renderClearButton()
  }
}
