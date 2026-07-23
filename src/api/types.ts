export type Envelope<T> = {
  code: number
  message: string
  data: T
}

export type UserInfo = {
  id: number
  username: string
  isStaff: boolean
}

export type DictItem = {
  id: number
  code: string
  name: string
}

export type IndicatorDefinition = {
  id: number
  code: string
  name: string
  displayName?: string
}

export type IndicatorInstance = {
  id: number
  defId: number
  instanceName: string
  scaleId?: number
  status?: string
}

export type Platform = {
  id: number
  name: string
  identifier?: string
  status?: string
}

export type ObservationTask = {
  id: number
  code: string
  name: string
  status: string
}
