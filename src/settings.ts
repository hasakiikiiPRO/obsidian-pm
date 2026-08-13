import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import type { SettingDefinitionItem, SettingDefinitionPage } from 'obsidian'
import type PMPlugin from './main'
import { type PMSettings, DEFAULT_SETTINGS, makeId } from './types'
import { flattenTasks } from './store/TaskTreeOps'
import {
  countTaskNotesPaletteChanges,
  getTaskNotesApi,
  importTaskNotesPalettes,
  isTaskNotesInstalled
} from './integrations/tasknotes'
import { renderPaletteFields, renderStatusDoneToggle } from './ui/PaletteListEditor'
import { t, tPlural } from './i18n'

export type { PMSettings }
export { DEFAULT_SETTINGS }

export class PMSettingTab extends PluginSettingTab {
  plugin: PMPlugin

  constructor(app: App, plugin: PMPlugin) {
    super(app, plugin)
    this.plugin = plugin
    this.icon = 'chart-gantt'
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: t('settings.general.heading'),
        items: [
          {
            name: t('settings.general.projectsFolder.name'),
            desc: t('settings.general.projectsFolder.desc'),
            control: {
              type: 'folder',
              key: 'projectsFolder',
              defaultValue: 'Projects',
              placeholder: 'Projects',
              validate: (value) => (value.trim() ? undefined : t('settings.general.projectsFolder.validate'))
            }
          },
          {
            name: t('settings.general.defaultView.name'),
            desc: t('settings.general.defaultView.desc'),
            control: {
              type: 'dropdown',
              key: 'defaultView',
              options: { table: t('view.table'), gantt: t('view.gantt'), kanban: t('view.board') }
            }
          },
          {
            name: t('settings.general.saveTaskOnClose.name'),
            desc: t('settings.general.saveTaskOnClose.desc'),
            control: { type: 'toggle', key: 'saveTaskOnClose' }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.style.heading'),
        items: [
          {
            name: t('settings.style.showTagColors.name'),
            desc: t('settings.style.showTagColors.desc'),
            aliases: ['appearance'],
            control: { type: 'toggle', key: 'showTagColors' }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.gantt.heading'),
        items: [
          {
            name: t('settings.gantt.granularity.name'),
            desc: t('settings.gantt.granularity.desc'),
            aliases: ['timeline', 'zoom'],
            control: {
              type: 'dropdown',
              key: 'ganttGranularity',
              options: {
                day: t('granularity.day'),
                week: t('granularity.week'),
                month: t('granularity.month'),
                quarter: t('granularity.quarter')
              }
            }
          },
          {
            name: t('settings.gantt.weekLabel.name'),
            desc: t('settings.gantt.weekLabel.desc'),
            aliases: ['timeline'],
            control: {
              type: 'dropdown',
              key: 'ganttWeekLabel',
              options: {
                weekNumber: t('weekLabel.weekNumber'),
                dateRange: t('weekLabel.dateRange'),
                both: t('weekLabel.both')
              }
            }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.board.heading'),
        items: [
          {
            name: t('settings.board.showSubtasks.name'),
            desc: t('settings.board.showSubtasks.desc'),
            aliases: ['kanban'],
            control: { type: 'toggle', key: 'kanbanShowSubtasks' }
          },
          {
            name: t('settings.board.showPreview.name'),
            desc: t('settings.board.showPreview.desc'),
            aliases: ['kanban'],
            control: { type: 'toggle', key: 'kanbanShowDescriptionPreview' }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.scheduling.heading'),
        items: [
          {
            name: t('settings.scheduling.autoSchedule.name'),
            desc: t('settings.scheduling.autoSchedule.desc'),
            aliases: ['dependencies'],
            control: { type: 'toggle', key: 'autoSchedule' }
          },
          {
            name: t('settings.scheduling.pullForward.name'),
            desc: t('settings.scheduling.pullForward.desc'),
            aliases: ['dependencies'],
            control: {
              type: 'toggle',
              key: 'pullForwardOnEarlyFinish',
              disabled: () => !this.plugin.settings.autoSchedule
            }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.notifications.heading'),
        items: [
          {
            name: t('settings.notifications.dueReminders.name'),
            desc: t('settings.notifications.dueReminders.desc'),
            aliases: ['notifications', 'banner'],
            control: { type: 'toggle', key: 'notificationsEnabled' }
          },
          {
            name: t('settings.notifications.daysInAdvance.name'),
            desc: t('settings.notifications.daysInAdvance.desc'),
            aliases: ['notifications', 'reminders', 'lead time'],
            control: {
              type: 'slider',
              key: 'notificationLeadDays',
              min: 1,
              max: 14,
              step: 1,
              disabled: () => !this.plugin.settings.notificationsEnabled
            }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.taskFields.heading'),
        items: [this.statusesPage(), this.prioritiesPage(), this.teamMembersPage()]
      },
      {
        type: 'group',
        heading: t('settings.integrations.heading'),
        visible: () => isTaskNotesInstalled(this.app),
        items: [this.taskNotesPage()]
      }
    ]
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    await super.setControlValue(key, value)
    if (key === 'kanbanShowDescriptionPreview') this.plugin.refreshProjectViews()
    this.refreshDomState()
  }

  private statusesPage(): SettingDefinitionPage {
    const statuses = this.plugin.settings.statuses
    return {
      type: 'page',
      name: t('settings.statuses.name'),
      desc: t('settings.statuses.desc'),
      displayValue: () => tPlural(this.plugin.settings.statuses.length, 'settings.statuses.count'),
      items: [
        {
          type: 'list',
          heading: t('settings.statuses.name'),
          emptyState: t('settings.statuses.empty'),
          items: statuses.map((status) => ({
            name: status.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, this.app, status, () => this.persist())
              renderStatusDoneToggle(setting.controlEl, status, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(statuses, from, to),
          onDelete: (index) => this.deleteEntry('status', index),
          addItem: {
            name: t('settings.statuses.add'),
            action: () => {
              statuses.push({
                id: 'status-' + makeId().slice(0, 6),
                label: t('settings.statuses.new'),
                color: '#8a94a0',
                icon: '',
                complete: false
              })
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private prioritiesPage(): SettingDefinitionPage {
    const priorities = this.plugin.settings.priorities
    return {
      type: 'page',
      name: t('settings.priorities.name'),
      desc: t('settings.priorities.desc'),
      displayValue: () => tPlural(this.plugin.settings.priorities.length, 'settings.priorities.count'),
      items: [
        {
          type: 'list',
          heading: t('settings.priorities.name'),
          emptyState: t('settings.priorities.empty'),
          items: priorities.map((priority) => ({
            name: priority.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, this.app, priority, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(priorities, from, to),
          onDelete: (index) => this.deleteEntry('priority', index),
          addItem: {
            name: t('settings.priorities.add'),
            action: () => {
              priorities.push({
                id: 'priority-' + makeId().slice(0, 6),
                label: t('settings.priorities.new'),
                color: '#8a94a0',
                icon: ''
              })
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private taskNotesPage(): SettingDefinitionPage {
    const connected = (): boolean => getTaskNotesApi(this.app) !== null
    return {
      type: 'page',
      name: t('settings.tasknotes.name'),
      desc: t('settings.tasknotes.desc'),
      displayValue: () => this.taskNotesStatus(),
      status: () => (connected() ? null : 'warning'),
      items: [
        {
          type: 'list',
          extraButtons: [
            (button) =>
              button
                .setIcon('refresh-cw')
                .setTooltip(t('settings.tasknotes.import'))
                .setDisabled(!connected())
                .onClick(() => this.importFromTaskNotes())
          ],
          items: [
            {
              name: t('settings.tasknotes.item.name'),
              desc: t('settings.tasknotes.item.desc'),
              render: (setting: Setting) => {
                setting.controlEl.createDiv({ cls: 'setting-item-value', text: this.taskNotesStatus() })
              }
            }
          ]
        }
      ]
    }
  }

  /** Whether an import would change anything right now. */
  private taskNotesStatus(): string {
    const api = getTaskNotesApi(this.app)
    if (!api) return t('settings.tasknotes.updateRequired')
    const { added, updated } = countTaskNotesPaletteChanges(api, this.plugin.settings)
    const total = added + updated
    return total === 0 ? t('settings.tasknotes.upToDate') : tPlural(total, 'settings.tasknotes.change')
  }

  private teamMembersPage(): SettingDefinitionPage {
    const members = this.plugin.settings.globalTeamMembers
    return {
      type: 'page',
      name: t('settings.team.name'),
      desc: t('settings.team.desc'),
      displayValue: () => tPlural(this.plugin.settings.globalTeamMembers.length, 'settings.team.count'),
      items: [
        {
          type: 'list',
          heading: t('settings.team.name'),
          emptyState: t('settings.team.empty'),
          items: members.map((member, index) => ({
            name: member || t('settings.team.unnamed'),
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              setting.addText((text) =>
                text
                  .setPlaceholder(t('common.name'))
                  .setValue(member)
                  .onChange((value) => {
                    this.plugin.settings.globalTeamMembers[index] = value
                    this.persist()
                  })
              )
            }
          })),
          onReorder: (from, to) => this.reorder(members, from, to),
          onDelete: (index) => {
            members.splice(index, 1)
            this.persist()
            this.update()
          },
          addItem: {
            name: t('settings.team.add'),
            action: () => {
              members.push('')
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private persist(): void {
    void this.plugin.saveSettings()
  }

  private reorder<T>(items: T[], from: number, to: number): void {
    const [moved] = items.splice(from, 1)
    items.splice(to, 0, moved)
    this.persist()
    this.update()
  }

  private deleteEntry(field: 'status' | 'priority', index: number): void {
    const entries = field === 'status' ? this.plugin.settings.statuses : this.plugin.settings.priorities
    if (entries.length <= 1) {
      new Notice(t('settings.atLeastOne', { field: t(`common.${field}`) }))
      return
    }
    const [removed] = entries.splice(index, 1)
    this.persist()
    this.update()
    void this.remapOrphanTasks(field, removed.id, removed.label)
  }

  private importFromTaskNotes(): void {
    const api = getTaskNotesApi(this.app)
    if (!api) {
      new Notice(t('settings.tasknotes.required'))
      return
    }
    const { added, updated } = importTaskNotesPalettes(api, this.plugin.settings)
    this.persist()
    this.update()
    new Notice(
      added || updated ? t('settings.tasknotes.imported', { added, updated }) : t('settings.tasknotes.alreadyMatch')
    )
  }

  private async remapOrphanTasks(field: 'status' | 'priority', deletedId: string, deletedLabel: string): Promise<void> {
    const configs = field === 'status' ? this.plugin.settings.statuses : this.plugin.settings.priorities
    if (configs.length === 0) return
    const fallback = configs[0]
    const folder = this.plugin.settings.projectsFolder
    const projects = await this.plugin.store.loadAllProjects(folder)
    let remapped = 0
    for (const project of projects) {
      // A project defining this status or priority itself is unaffected by a global delete.
      const own = field === 'status' ? project.config?.statuses : project.config?.priorities
      if (own?.some((entry) => entry.id === deletedId)) continue
      const ids = flattenTasks(project.tasks)
        .filter(({ task }) => task[field] === deletedId)
        .map(({ task }) => task.id)
      if (ids.length) {
        await this.plugin.store.updateTasks(project, ids, { [field]: fallback.id })
        remapped += ids.length
      }
    }
    if (remapped > 0) {
      new Notice(t('settings.remapped', { count: remapped, from: deletedLabel, to: fallback.label }))
    }
  }
}
