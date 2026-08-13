import { Menu, Notice } from 'obsidian'
import type PMPlugin from '../main'
import type { Task, Project } from '../types'
import { safeAsync } from '../utils'
import { openTaskModal, confirmDialog, confirmDuplicateSubtasks } from './ModalFactory'
import { t } from '../i18n'

export interface TaskMenuContext {
  plugin: PMPlugin
  project: Project
  onRefresh: () => Promise<void>
}

/** Edit, Add subtask, Archive/Unarchive, Delete. */
export function buildTaskContextMenu(menu: Menu, task: Task, ctx: TaskMenuContext): Menu {
  menu.addItem((item) =>
    item
      .setTitle(t('menu.editTask'))
      .setIcon('pencil')
      .onClick(() => {
        openTaskModal(ctx.plugin, ctx.project, {
          task,
          onSave: async () => {
            await ctx.onRefresh()
          }
        })
      })
  )
  menu.addItem((item) =>
    item
      .setTitle(t('menu.addSubtask'))
      .setIcon('plus')
      .onClick(() => {
        openTaskModal(ctx.plugin, ctx.project, {
          parentId: task.id,
          onSave: async () => {
            await ctx.onRefresh()
          }
        })
      })
  )
  menu.addItem((item) =>
    item
      .setTitle(t('menu.duplicateTask'))
      .setIcon('copy')
      .onClick(
        safeAsync(async () => {
          let includeSubtasks = false
          if (task.subtasks.length > 0) {
            const choice = await confirmDuplicateSubtasks(ctx.plugin.app, task.title)
            if (choice === null) return
            includeSubtasks = choice === 'with-subtasks'
          }
          await ctx.plugin.store.duplicateTask(ctx.project, task.id, includeSubtasks)
          await ctx.onRefresh()
        })
      )
  )
  menu.addSeparator()
  if (task.archived) {
    menu.addItem((item) =>
      item
        .setTitle(t('menu.unarchive'))
        .setIcon('archive-restore')
        .onClick(
          safeAsync(async () => {
            await ctx.plugin.store.unarchiveTask(ctx.project, task.id)
            new Notice(t('task.unarchived'))
            await ctx.onRefresh()
          })
        )
    )
  } else {
    menu.addItem((item) =>
      item
        .setTitle(t('menu.archive'))
        .setIcon('archive')
        .onClick(
          safeAsync(async () => {
            await ctx.plugin.store.archiveTask(ctx.project, task.id)
            new Notice(t('task.archived'))
            await ctx.onRefresh()
          })
        )
    )
  }
  menu.addItem((item) =>
    item
      .setTitle(t('menu.deleteTask'))
      .setIcon('trash')
      .onClick(
        safeAsync(async () => {
          if (await confirmDialog(ctx.plugin.app, t('task.deleteConfirm', { title: task.title }))) {
            await ctx.plugin.store.deleteTask(ctx.project, task.id)
            await ctx.onRefresh()
          }
        })
      )
  )
  return menu
}
