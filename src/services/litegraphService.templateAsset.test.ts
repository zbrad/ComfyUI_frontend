import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LGraphNode } from '@/lib/litegraph/src/litegraph'
import type { IComboWidget } from '@/lib/litegraph/src/types/widgets'

const { mockFetchApi, mockAddAlert, mockUpdateInputs } = vi.hoisted(() => ({
  mockFetchApi: vi.fn(),
  mockAddAlert: vi.fn(),
  mockUpdateInputs: vi.fn()
}))

vi.mock('@/scripts/app', () => ({
  app: { canvas: undefined },
  ComfyApp: class {}
}))

vi.mock('@/scripts/api', () => ({
  api: { fetchApi: mockFetchApi }
}))

vi.mock('@/platform/updates/common/toastStore', () => ({
  useToastStore: () => ({ addAlert: mockAddAlert })
}))

vi.mock('@/stores/assetsStore', () => ({
  useAssetsStore: () => ({ updateInputs: mockUpdateInputs })
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))

vi.mock('@vueuse/router', () => ({
  useRouteHash: () => ({ value: '' })
}))

import {
  GET_CONFIG,
  getMissingTemplateAssetOption
} from '@/services/litegraphService'

const MEDIA_UPLOAD_CONFIG = [
  'COMBO',
  { image_upload: true, values: [] }
] as const

function createNode(configName = 'image'): LGraphNode {
  return {
    inputs: [
      {
        widget: {
          name: configName,
          [GET_CONFIG]: () => MEDIA_UPLOAD_CONFIG
        }
      }
    ],
    onWidgetChanged: vi.fn(),
    graph: { setDirtyCanvas: vi.fn(), isRootGraph: true }
  } as unknown as LGraphNode
}

function createComboWidget(value: string, values: string[]): IComboWidget {
  return {
    name: 'image',
    type: 'combo',
    value,
    options: { values },
    callback: vi.fn()
  } as unknown as IComboWidget
}

function jsonUploadResponse(name: string) {
  return { status: 200, json: () => Promise.resolve({ name }) }
}

describe('getMissingTemplateAssetOption', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['data'], { type: 'image/png' }))
      })
    )
  })

  it('offers the download option when the combo value is missing from its options', () => {
    const node = createNode()
    const widget = createComboWidget('missing_example.png', [])

    expect(getMissingTemplateAssetOption(node, widget)?.content).toBe(
      'Download from Template Source'
    )
  })

  it('does not offer the option when the value is already a valid choice', () => {
    const node = createNode()
    const widget = createComboWidget('present.png', ['present.png'])

    expect(getMissingTemplateAssetOption(node, widget)).toBeUndefined()
  })

  it('does not offer the option for combos that are not media uploads', () => {
    const node = {
      inputs: [
        {
          widget: {
            name: 'sampler_name',
            [GET_CONFIG]: () => ['COMBO', { values: [] }]
          }
        }
      ],
      onWidgetChanged: vi.fn(),
      graph: { setDirtyCanvas: vi.fn(), isRootGraph: true }
    } as unknown as LGraphNode
    const widget = createComboWidget('euler', [])
    widget.name = 'sampler_name'

    expect(getMissingTemplateAssetOption(node, widget)).toBeUndefined()
  })

  it('does not offer the option for a widget with no matching input socket', () => {
    const node = createNode('some_other_widget')
    const widget = createComboWidget('missing_example.png', [])

    expect(getMissingTemplateAssetOption(node, widget)).toBeUndefined()
  })

  it('fetches the asset from the template source and uploads it into input', async () => {
    mockFetchApi.mockResolvedValueOnce(
      jsonUploadResponse('missing_example.png')
    )
    const node = createNode()
    const widget = createComboWidget('missing_example.png', [])

    const option = getMissingTemplateAssetOption(node, widget)!
    ;(option.callback as unknown as () => void)?.()
    await vi.waitFor(() => expect(mockFetchApi).toHaveBeenCalled())

    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/input/missing_example.png'
    )
    expect(mockFetchApi).toHaveBeenCalledWith(
      '/upload/image',
      expect.objectContaining({ method: 'POST' })
    )
    expect(widget.value).toBe('missing_example.png')
    expect(widget.options.values).toContain('missing_example.png')
    expect(widget.callback).toHaveBeenCalledWith('missing_example.png')
    expect(node.onWidgetChanged).toHaveBeenCalledWith(
      'image',
      'missing_example.png',
      'missing_example.png',
      widget
    )
    expect(node.graph?.setDirtyCanvas).toHaveBeenCalledWith(true)
  })

  it('shows a toast and leaves the widget untouched when the source fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
    )
    const node = createNode()
    const widget = createComboWidget('missing_example.png', [])

    const option = getMissingTemplateAssetOption(node, widget)!
    ;(option.callback as unknown as () => void)?.()
    await vi.waitFor(() => expect(mockAddAlert).toHaveBeenCalled())

    expect(mockAddAlert).toHaveBeenCalledWith('Error: 404 Not Found')
    expect(mockFetchApi).not.toHaveBeenCalled()
    expect(widget.value).toBe('missing_example.png')
  })
})
