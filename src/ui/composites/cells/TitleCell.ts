import type { Task } from '../../../types'
import { Chip } from '../../primitives/Chip'
import { IconButton } from '../../primitives/IconButton'
import { renderTagChip } from '../tagChip'
import { makeInlineEdit } from './inlineEdit'
import { t } from '../../../i18n'

export interface TitleCellProps {
  task: Task
  depth: number
  showTagColors: boolean
  onTitleClick: () => void
  onTitleSave: (newTitle: string) => Promise<void>
  onAddSubtask: () => void
}

export class TitleCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: TitleCellProps) {
    const { task } = props
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell-title' })
    this.el.setCssStyles({ paddingLeft: `${props.depth * 20 + 8}px` })

    const titleSpan = this.el.createSpan({ text: task.title, cls: 'pm-task-title-text' })
    titleSpan.addEventListener('click', () => props.onTitleClick())
    titleSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      makeInlineEdit({
        container: this.el,
        display: titleSpan,
        inputType: 'text',
        value: task.title,
        onSave: props.onTitleSave
      })
    })

    new IconButton(this.el)
      .setIcon('plus')
      .setTooltip(t('menu.addSubtask'))
      .setRevealOnHover(true)
      .onClick((e) => {
        e.stopPropagation()
        props.onAddSubtask()
      })

    if (task.type === 'milestone') {
      new Chip(this.el)
        .setLabel('M')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-purple)')
        .setTooltip(t('kanban.milestone'))
    }
    if (task.type === 'subtask') {
      new Chip(this.el)
        .setLabel('Sub')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-green)')
        .setTooltip(t('kanban.subtask'))
    }
    if (task.recurrence) {
      new Chip(this.el)
        .setLabel('R')
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-blue)')
        .setTooltip(t('kanban.recurring'))
    }
    if (task.archived) {
      new Chip(this.el)
        .setLabel(t('filter.archived'))
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--text-muted)')
        .setTooltip(t('filter.archived'))
    }

    if (task.tags.length) {
      const tagRow = this.el.createDiv('pm-table-tags')
      for (const tag of task.tags) {
        renderTagChip(tagRow, tag, props.showTagColors)
      }
    }
  }
}
