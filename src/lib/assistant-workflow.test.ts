import { describe, expect, it } from 'vitest'
import {
  isHandoffRequest,
  isProjectOrganizationRequest,
  isStartWorkRequest,
} from './assistant-workflow'
describe('explicit discussion workflow commands', () => {
  it.each([
    '帮我整理一下工程代码库',
    '请整理当前工程',
    '现在整理工程，保留原来的声音',
    '请帮我整理一下项目',
    'Please organize the project',
    'Clean up this codebase',
  ])('recognizes an explicit organization request: %s', text =>
    expect(isProjectOrganizationRequest(text)).toBe(true)
  )
  it.each([
    '要不要整理工程？',
    '帮我整理工程会怎样？',
    '不要帮我整理工程',
    '我想讨论“帮我整理一下工程代码库”这个请求',
    '帮我整理工程只是举例',
    '帮我整理工程，别开始',
    'Should we organize the project?',
    'The document says: organize the project',
  ])('keeps questions, quoted instructions and refusals read-only: %s', text =>
    expect(isProjectOrganizationRequest(text)).toBe(false)
  )
  it('distinguishes explicit next-step choices from discussion', () => {
    expect(isHandoffRequest('帮我写交接文件')).toBe(true)
    expect(isHandoffRequest('不要写交接文件')).toBe(false)
    expect(isStartWorkRequest('按这个方案实现')).toBe(true)
    expect(isStartWorkRequest('开始工作是什么意思？')).toBe(false)
  })
})
