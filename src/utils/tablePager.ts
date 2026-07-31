import type { Directive, DirectiveBinding } from 'vue'

type TablePagerOptions = {
  pageSize?: number
  label?: string
}

type TablePagerValue = number | TablePagerOptions | undefined

type TablePagerState = {
  page: number
  pageSize: number
  label: string
  region: HTMLDivElement
  pager: HTMLElement
  total: HTMLSpanElement
  pageSelect: HTMLSelectElement
  pageCountLabel: HTMLSpanElement
  previous: HTMLButtonElement
  next: HTMLButtonElement
}

const states = new WeakMap<HTMLTableElement, TablePagerState>()

function options(value: TablePagerValue) {
  if (typeof value === 'number') return { pageSize: value, label: '表格分页' }
  return {
    pageSize: Math.max(1, Number(value?.pageSize || 4)),
    label: value?.label || '表格分页',
  }
}

function tableRows(table: HTMLTableElement) {
  return Array.from(table.tBodies).flatMap((body) => Array.from(body.rows))
}

function isEmptyRow(row: HTMLTableRowElement) {
  return Boolean(row.querySelector('td[colspan].muted'))
}

function render(table: HTMLTableElement, state: TablePagerState) {
  const rows = tableRows(table)
  const emptyOnly = rows.length === 1 && isEmptyRow(rows[0]!)
  const total = emptyOnly ? 0 : rows.length
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize))
  state.page = Math.min(Math.max(1, state.page), pageCount)
  const start = (state.page - 1) * state.pageSize
  const end = start + state.pageSize

  rows.forEach((row, index) => {
    row.style.display = emptyOnly || (index >= start && index < end) ? '' : 'none'
  })

  state.total.textContent = `共 ${total} 条`
  if (state.pageSelect.options.length !== pageCount) {
    state.pageSelect.replaceChildren(...Array.from({ length: pageCount }, (_, index) => {
      const page = index + 1
      return new Option(String(page), String(page))
    }))
  }
  state.pageSelect.value = String(state.page)
  state.pageCountLabel.textContent = `/ ${pageCount} 页`
  state.previous.disabled = state.page <= 1
  state.next.disabled = state.page >= pageCount
  state.pager.hidden = total <= state.pageSize
  state.pager.setAttribute('aria-label', state.label)
}

function createButton(label: string, symbol: string) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'table-pager-button'
  button.setAttribute('aria-label', label)
  button.title = label
  const icon = document.createElement('span')
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = symbol
  button.append(icon)
  return button
}

function mounted(table: HTMLTableElement, binding: DirectiveBinding<TablePagerValue>) {
  const config = options(binding.value)
  const parent = table.parentElement
  if (!parent) return

  const region = document.createElement('div')
  region.className = 'table-region'
  const scroll = document.createElement('div')
  scroll.className = 'table-scroll'
  const pager = document.createElement('nav')
  pager.className = 'table-pager'

  const total = document.createElement('span')
  total.className = 'table-pager-total'
  const controls = document.createElement('span')
  controls.className = 'table-pager-controls'
  const previous = createButton('上一页', '‹')
  const position = document.createElement('label')
  position.className = 'table-pager-position'
  const selectLabel = document.createElement('span')
  selectLabel.className = 'table-pager-sr-only'
  selectLabel.textContent = '选择页码'
  const pageSelect = document.createElement('select')
  pageSelect.setAttribute('aria-label', '选择页码')
  const pageCountLabel = document.createElement('span')
  const next = createButton('下一页', '›')
  position.append(selectLabel, pageSelect, pageCountLabel)
  controls.append(previous, position, next)
  pager.append(total, controls)
  parent.insertBefore(region, table)
  scroll.append(table)
  region.append(scroll, pager)

  const state: TablePagerState = {
    page: 1,
    pageSize: config.pageSize,
    label: config.label,
    region,
    pager,
    total,
    pageSelect,
    pageCountLabel,
    previous,
    next,
  }
  states.set(table, state)
  previous.addEventListener('click', () => {
    state.page -= 1
    render(table, state)
  })
  next.addEventListener('click', () => {
    state.page += 1
    render(table, state)
  })
  pageSelect.addEventListener('change', () => {
    state.page = Number(pageSelect.value)
    render(table, state)
  })
  render(table, state)
}

function updated(table: HTMLTableElement, binding: DirectiveBinding<TablePagerValue>) {
  const state = states.get(table)
  if (!state) return
  const config = options(binding.value)
  state.pageSize = config.pageSize
  state.label = config.label
  render(table, state)
}

function unmounted(table: HTMLTableElement) {
  const state = states.get(table)
  if (!state) return
  tableRows(table).forEach((row) => { row.style.display = '' })
  state.region.remove()
  states.delete(table)
}

export const tablePager: Directive<HTMLTableElement, TablePagerValue> = {
  mounted,
  updated,
  unmounted,
}
