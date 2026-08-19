import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentMarkdown } from './AgentMarkdown'

describe('AgentMarkdown', () => {
  it('renders model-authored headings, emphasis, lists, quotes, and code without exposing Markdown markers', () => {
    const { container } = render(
      <AgentMarkdown content={'候选人 **CANDIDATE_1** 整体情况如下：\n\n**基本信息**\n- 候选人状态：当前\n  - 可安排\n\n> 仅供招聘判断\n\n`Java`'} />
    )

    expect(screen.getByText('CANDIDATE_1').tagName).toBe('STRONG')
    expect(screen.getByRole('heading', { name: '基本信息', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByText('可安排')).toHaveClass('is-nested')
    expect(screen.getByText('仅供招聘判断').tagName).toBe('BLOCKQUOTE')
    expect(screen.getByText('Java').tagName).toBe('CODE')
    expect(container).not.toHaveTextContent('**')
  })

  it('renders fenced code and numbered steps as semantic content', () => {
    render(<AgentMarkdown content={'## 判断过程\n1. 读取案件\n2. 获取候选人\n\n```\nMATCH 95\n```'} />)

    expect(screen.getByRole('heading', { name: '判断过程', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('list')).toHaveTextContent('读取案件')
    expect(screen.getByText('MATCH 95')).toBeInTheDocument()
  })
})
