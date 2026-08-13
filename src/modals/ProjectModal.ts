import { App, ButtonComponent, Modal } from 'obsidian'
import type PMPlugin from '../main'
import { type Project, type ProjectConfig, type ProjectPatch, type CustomFieldDef, makeId, makeProject } from '../types'
import { safeAsync } from '../utils'
import { renderAddButton } from '../ui/composites/addButton'
import { Avatar } from '../ui/primitives/Avatar'
import { IconButton } from '../ui/primitives/IconButton'
import { renderPriorityListEditor, renderStatusListEditor } from '../ui/PaletteListEditor'
import { t } from '../i18n'

const PROJECT_COLORS = [
  '#8b72be',
  '#7c6b9a',
  '#b07d9e',
  '#c47070',
  '#b8a06b',
  '#79b58d',
  '#6ba8a0',
  '#7a9ec4',
  '#767491',
  '#8aab6b'
]

const PROJECT_ICONS = ['📋', '🚀', '💡', '🎯', '🔬', '🏗', '📊', '🎨', '📱', '🛠', '📝', '⚡']

/** The project fields this modal edits. Tasks and saved views are not among them. */
interface ProjectDraft {
  title: string
  description: string
  color: string
  icon: string
  customFields: CustomFieldDef[]
  teamMembers: string[]
  config: ProjectConfig | undefined
}

function draftOf(project: Project): ProjectDraft {
  const { title, description, color, icon, customFields, teamMembers, config } = project
  const draft = { title, description, color, icon, customFields, teamMembers, config }
  return JSON.parse(JSON.stringify(draft)) as ProjectDraft
}

/** Edits a draft of the project's own fields, never the project itself, and saves only what changed. */
export class ProjectModal extends Modal {
  private draft: ProjectDraft
  private original: ProjectDraft
  private isNew: boolean

  constructor(
    app: App,
    private plugin: PMPlugin,
    private existingProject: Project | null,
    private onSave: (project: Project) => void | Promise<void>
  ) {
    super(app)
    this.isNew = existingProject === null
    const base = existingProject ?? makeProject(t('project.newTitle'), '')
    this.draft = draftOf(base)
    this.original = draftOf(base)
  }

  /** Only what changed, so the form can't write back anything it never showed. */
  private changedFields(): ProjectPatch {
    const patch: ProjectPatch = {}
    for (const key of Object.keys(this.draft) as (keyof ProjectDraft)[]) {
      if (JSON.stringify(this.draft[key]) !== JSON.stringify(this.original[key])) {
        Object.assign(patch, { [key]: this.draft[key] })
      }
    }
    return patch
  }

  onOpen(): void {
    this.modalEl.addClass('pm-modal', 'pm-modal--project')
    const el = this.contentEl
    el.empty()
    el.addClass('pm-project-modal')
    this.buildForm(el)
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private buildForm(el: HTMLElement): void {
    const header = el.createDiv('pm-project-modal-header')
    header.createSpan({ text: '✦', cls: 'pm-project-modal-header-icon' })
    header.createEl('h2', {
      text: this.isNew ? t('project.newTitle') : t('project.settingsTitle'),
      cls: 'pm-modal-heading'
    })

    const topRow = el.createDiv('pm-project-top-row')

    const iconWrap = topRow.createDiv('pm-icon-picker')
    const iconBtn = iconWrap.createEl('button', { text: this.draft.icon, cls: 'pm-icon-picker-btn' })

    const iconGrid = iconWrap.createDiv('pm-icon-grid')
    iconGrid.addClass('pm-hidden')
    for (const emoji of PROJECT_ICONS) {
      const btn = iconGrid.createEl('button', { text: emoji, cls: 'pm-icon-option' })
      btn.addEventListener('click', () => {
        this.draft.icon = emoji
        iconBtn.textContent = emoji
        iconGrid.addClass('pm-hidden')
      })
    }
    iconBtn.addEventListener('click', () => {
      iconGrid.toggleClass('pm-hidden', !iconGrid.hasClass('pm-hidden'))
    })

    const titleWrap = topRow.createDiv('pm-project-title-wrap')
    titleWrap.createEl('label', { text: t('project.name'), cls: 'pm-label' })
    const titleInput = titleWrap.createEl('input', {
      type: 'text',
      value: this.draft.title,
      cls: 'pm-input pm-input--lg'
    })
    titleInput.placeholder = t('project.namePlaceholder')
    titleInput.addEventListener('input', () => {
      this.draft.title = titleInput.value
    })
    window.setTimeout(() => {
      titleInput.focus()
      titleInput.select()
    }, 50)

    const colorSection = el.createDiv('pm-project-modal-section')
    colorSection.createEl('label', { text: t('project.color'), cls: 'pm-label' })
    const colorPalette = colorSection.createDiv('pm-color-palette')
    for (const color of PROJECT_COLORS) {
      const swatch = colorPalette.createEl('button', { cls: 'pm-color-swatch' })
      swatch.setCssStyles({ background: color })
      if (color === this.draft.color) swatch.addClass('pm-color-swatch--selected')
      swatch.addEventListener('click', () => {
        this.draft.color = color
        colorPalette.querySelectorAll('.pm-color-swatch').forEach((s) => s.removeClass('pm-color-swatch--selected'))
        swatch.addClass('pm-color-swatch--selected')
      })
    }
    const customColor = colorPalette.createEl('input', { type: 'color', cls: 'pm-color-custom' })
    customColor.value = this.draft.color
    customColor.title = t('project.customColor')
    customColor.addEventListener('change', () => {
      this.draft.color = customColor.value
      colorPalette.querySelectorAll('.pm-color-swatch').forEach((s) => s.removeClass('pm-color-swatch--selected'))
    })

    const descSection = el.createDiv('pm-project-modal-section')
    descSection.createEl('label', { text: t('project.description'), cls: 'pm-label' })
    const descArea = descSection.createEl('textarea', { cls: 'pm-input pm-project-desc' })
    descArea.placeholder = t('project.descriptionPlaceholder')
    descArea.value = this.draft.description
    descArea.addEventListener('input', () => {
      this.draft.description = descArea.value
    })

    const memberSection = el.createDiv('pm-modal-section')
    memberSection.createEl('label', { text: t('project.teamMembers'), cls: 'pm-label' })
    const memberWrap = memberSection.createDiv('pm-member-list')
    const renderMembers = () => {
      memberWrap.empty()
      for (let i = 0; i < this.draft.teamMembers.length; i++) {
        const row = memberWrap.createDiv('pm-member-row')
        const name = this.draft.teamMembers[i] || '?'
        new Avatar(row).setName(name)
        const input = row.createEl('input', {
          type: 'text',
          value: this.draft.teamMembers[i],
          cls: 'pm-input pm-member-input'
        })
        input.placeholder = t('common.name')
        input.addEventListener('change', () => {
          this.draft.teamMembers[i] = input.value
          renderMembers()
        })
        new IconButton(row)
          .setIcon('x')
          .setTooltip(t('project.removeMember'))
          .onClick(() => {
            this.draft.teamMembers.splice(i, 1)
            renderMembers()
          })
      }
      renderAddButton(memberWrap, t('project.addMember'), () => {
        this.draft.teamMembers.push('')
        renderMembers()
        window.setTimeout(() => {
          const inputs = memberWrap.querySelectorAll('input')
          inputs[inputs.length - 1]?.focus()
        }, 50)
      })
    }
    renderMembers()

    const cfSection = el.createDiv('pm-modal-section')
    const cfHeader = cfSection.createDiv('pm-modal-section-header')
    cfHeader.createSpan({ text: t('project.customFields'), cls: 'pm-modal-subheading' })
    cfHeader.createSpan({ text: t('project.customFieldsHint'), cls: 'pm-modal-hint' })

    const cfList = cfSection.createDiv('pm-cf-list')
    const renderCFs = () => {
      cfList.empty()
      for (let i = 0; i < this.draft.customFields.length; i++) {
        this.renderCustomFieldEditor(cfList, this.draft.customFields[i], i, renderCFs)
      }
      renderAddButton(cfList, t('project.addCustomField'), () => {
        this.draft.customFields.push({
          id: makeId(),
          name: t('project.newField'),
          type: 'text',
          options: []
        })
        renderCFs()
      })
    }
    renderCFs()

    this.renderPaletteOverride(el, {
      heading: t('project.statuses'),
      hint: t('project.statusesHint'),
      toggleLabel: t('project.useCustomStatuses'),
      addLabel: t('project.addStatus'),
      get: () => this.draft.config?.statuses,
      set: (statuses) => this.patchConfig('statuses', statuses),
      copyGlobal: () => this.plugin.settings.statuses.map((s) => ({ ...s })),
      makeEntry: () => ({
        id: 'status-' + makeId().slice(0, 6),
        label: t('project.newStatus'),
        color: '#8a94a0',
        icon: '',
        complete: false
      }),
      renderEditor: (container, statuses) =>
        renderStatusListEditor(container, {
          app: this.app,
          statuses,
          // The modal edits a clone; everything persists on Save.
          onChanged: () => {}
        })
    })

    this.renderPaletteOverride(el, {
      heading: t('project.priorities'),
      hint: t('project.prioritiesHint'),
      toggleLabel: t('project.useCustomPriorities'),
      addLabel: t('project.addPriority'),
      get: () => this.draft.config?.priorities,
      set: (priorities) => this.patchConfig('priorities', priorities),
      copyGlobal: () => this.plugin.settings.priorities.map((p) => ({ ...p })),
      makeEntry: () => ({
        id: 'priority-' + makeId().slice(0, 6),
        label: t('project.newPriority'),
        color: '#8a94a0',
        icon: ''
      }),
      renderEditor: (container, priorities) =>
        renderPriorityListEditor(container, {
          app: this.app,
          priorities,
          onChanged: () => {}
        })
    })

    const behaviorSection = el.createDiv('pm-modal-section')
    const behaviorHeader = behaviorSection.createDiv('pm-modal-section-header')
    behaviorHeader.createSpan({ text: t('project.viewScheduling'), cls: 'pm-modal-subheading' })
    behaviorHeader.createSpan({ text: t('project.viewSchedulingHint'), cls: 'pm-modal-hint' })
    const behaviorGrid = behaviorSection.createDiv('pm-config-override-grid')

    this.renderOverrideSelect(behaviorGrid, t('project.defaultView'), 'defaultView', [
      { value: 'table', label: t('view.table') },
      { value: 'gantt', label: t('view.gantt') },
      { value: 'kanban', label: t('view.board') }
    ])
    this.renderOverrideSelect(behaviorGrid, t('project.autoSchedule'), 'autoSchedule', [
      { value: true, label: t('common.on') },
      { value: false, label: t('common.off') }
    ])
    this.renderOverrideSelect(behaviorGrid, t('project.pullForward'), 'pullForwardOnEarlyFinish', [
      { value: true, label: t('common.on') },
      { value: false, label: t('common.off') }
    ])
    this.renderOverrideSelect(behaviorGrid, t('project.subtasksOnBoard'), 'kanbanShowSubtasks', [
      { value: true, label: t('common.show') },
      { value: false, label: t('common.hide') }
    ])
    this.renderOverrideSelect(behaviorGrid, t('project.descPreviewOnBoard'), 'kanbanShowDescriptionPreview', [
      { value: true, label: t('common.show') },
      { value: false, label: t('common.hide') }
    ])

    const footer = el.createDiv('pm-modal-footer')
    footer.createDiv('pm-footer-spacer')

    new ButtonComponent(footer).setButtonText(t('common.cancel')).onClick(() => this.close())

    new ButtonComponent(footer)
      .setButtonText(this.isNew ? t('project.createProject') : t('common.save'))
      .setCta()
      .onClick(
        safeAsync(async () => {
          const title = titleInput.value.trim()
          if (!title) {
            titleInput.addClass('pm-input-error')
            titleInput.focus()
            return
          }
          this.draft.title = title

          const folder = this.plugin.settings.projectsFolder
          if (!this.existingProject) {
            const project = makeProject(title, `${folder}/${title.replace(/[\\/:*?"<>|]/g, '-')}.md`)
            Object.assign(project, this.draft)
            await this.plugin.store.ensureFolder(folder)
            await this.plugin.store.saveProject(project)
            await this.onSave(project)
          } else {
            await this.plugin.store.updateProject(this.existingProject, this.changedFields())
            await this.onSave(this.existingProject)
          }
          this.close()
        })
      )
  }

  /** Set or clear one override; the config object is dropped entirely when its last field clears. */
  private patchConfig<K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K] | undefined): void {
    const entries = Object.entries({ ...this.draft.config, [key]: value }).filter(([, v]) => v !== undefined)
    this.draft.config = entries.length ? Object.fromEntries(entries) : undefined
  }

  private renderPaletteOverride<T>(
    el: HTMLElement,
    opts: {
      heading: string
      hint: string
      toggleLabel: string
      addLabel: string
      get: () => T[] | undefined
      set: (items: T[] | undefined) => void
      copyGlobal: () => T[]
      makeEntry: () => T
      renderEditor: (container: HTMLElement, items: T[]) => void
    }
  ): void {
    const section = el.createDiv('pm-modal-section')
    const header = section.createDiv('pm-modal-section-header')
    header.createSpan({ text: opts.heading, cls: 'pm-modal-subheading' })
    header.createSpan({ text: opts.hint, cls: 'pm-modal-hint' })

    const toggle = section.createEl('label', { cls: 'pm-status-toggle' })
    const checkbox = toggle.createEl('input', { type: 'checkbox' })
    checkbox.checked = !!opts.get()?.length
    toggle.createSpan({ text: opts.toggleLabel })

    const editor = section.createDiv('pm-settings-statuses')
    const footer = section.createDiv()
    const renderEditor = () => {
      editor.empty()
      footer.empty()
      const own = opts.get()
      if (!own?.length) return
      opts.renderEditor(editor, own)
      renderAddButton(footer, opts.addLabel, () => {
        own.push(opts.makeEntry())
        renderEditor()
      })
    }
    checkbox.addEventListener('change', () => {
      // Starting from a copy of the global list keeps existing task values valid.
      opts.set(checkbox.checked ? opts.copyGlobal() : undefined)
      renderEditor()
    })
    renderEditor()
  }

  private renderOverrideSelect<
    K extends
      | 'defaultView'
      | 'autoSchedule'
      | 'pullForwardOnEarlyFinish'
      | 'kanbanShowSubtasks'
      | 'kanbanShowDescriptionPreview'
  >(
    grid: HTMLElement,
    label: string,
    key: K,
    options: { value: NonNullable<ProjectConfig[K]>; label: string }[]
  ): void {
    const row = grid.createDiv('pm-config-override-row')
    row.createEl('label', { text: label, cls: 'pm-label' })
    const select = row.createEl('select', { cls: 'pm-input pm-select' })
    const current = this.draft.config?.[key]
    const inherit = select.createEl('option', { value: '', text: t('project.useGlobal') })
    inherit.selected = current === undefined
    options.forEach((opt, i) => {
      const optionEl = select.createEl('option', { value: String(i), text: opt.label })
      if (current === opt.value) optionEl.selected = true
    })
    select.addEventListener('change', () => {
      this.patchConfig(key, select.value === '' ? undefined : options[Number(select.value)].value)
    })
  }

  private renderCustomFieldEditor(
    container: HTMLElement,
    cf: CustomFieldDef,
    index: number,
    rerender: () => void
  ): void {
    const row = container.createDiv('pm-cf-row')

    const nameInput = row.createEl('input', {
      type: 'text',
      value: cf.name,
      cls: 'pm-input pm-cf-name'
    })
    nameInput.placeholder = t('project.fieldName')
    nameInput.addEventListener('change', () => {
      this.draft.customFields[index].name = nameInput.value
    })

    const typeSelect = row.createEl('select', { cls: 'pm-input pm-select pm-cf-type' })
    const types: [CustomFieldDef['type'], string][] = [
      ['text', t('project.typeText')],
      ['number', t('project.typeNumber')],
      ['date', t('project.typeDate')],
      ['select', t('project.typeSelect')],
      ['multiselect', t('project.typeMultiselect')],
      ['person', t('project.typePerson')],
      ['checkbox', t('project.typeCheckbox')],
      ['url', t('project.typeUrl')]
    ]
    for (const [val, label] of types) {
      const opt = typeSelect.createEl('option', { value: val, text: label })
      if (val === cf.type) opt.selected = true
    }
    typeSelect.addEventListener('change', () => {
      this.draft.customFields[index].type = typeSelect.value as CustomFieldDef['type']
      rerender()
    })

    new IconButton(row)
      .setIcon('x')
      .setTooltip(t('project.removeField'))
      .onClick(() => {
        this.draft.customFields.splice(index, 1)
        rerender()
      })

    if (cf.type === 'select' || cf.type === 'multiselect') {
      const optionsWrap = row.createDiv('pm-cf-options')
      const opts = cf.options ?? []
      const renderOpts = () => {
        optionsWrap.empty()
        for (let j = 0; j < opts.length; j++) {
          const optRow = optionsWrap.createDiv('pm-cf-opt-row')
          const optInput = optRow.createEl('input', {
            type: 'text',
            value: opts[j],
            cls: 'pm-input pm-cf-opt-input'
          })
          optInput.placeholder = t('project.optionN', { n: j + 1 })
          optInput.addEventListener('change', () => {
            opts[j] = optInput.value
            cf.options = opts
          })
          new IconButton(optRow)
            .setIcon('x')
            .setTooltip(t('project.removeOption'))
            .onClick(() => {
              opts.splice(j, 1)
              cf.options = opts
              renderOpts()
            })
        }
        renderAddButton(optionsWrap, t('project.addOption'), () => {
          opts.push('')
          cf.options = opts
          renderOpts()
        })
      }
      renderOpts()
    }
  }
}
