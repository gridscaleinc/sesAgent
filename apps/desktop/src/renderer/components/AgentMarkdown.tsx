import { Fragment, useMemo, type ReactNode } from 'react'

type MarkdownBlock =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: Array<{ text: string; nested: boolean }> }
  | { type: 'ordered-list'; items: Array<{ text: string; nested: boolean }> }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }

function inlineMarkdown(value: string): ReactNode[] {
  const tokens = value.split(/(\*\*[^*]+\*\*|`[^`\n]+`)/gu)
  return tokens.filter(Boolean).map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={`${index}-${token}`}>{token.slice(2, -2)}</strong>
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={`${index}-${token}`}>{token.slice(1, -1)}</code>
    }
    return <Fragment key={`${index}-${token}`}>{token}</Fragment>
  })
}

function parseMarkdown(value: string): MarkdownBlock[] {
  const lines = value.replaceAll('\r\n', '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.trimStart().startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }

    const markdownHeading = line.match(/^\s*(#{2,3})\s+(.+)$/u)
    const strongHeading = line.match(/^\s*\*\*(.+)\*\*\s*$/u)
    if (markdownHeading?.[2] || strongHeading?.[1]) {
      blocks.push({
        type: 'heading',
        level: markdownHeading?.[1]?.length === 2 ? 2 : 3,
        text: (markdownHeading?.[2] ?? strongHeading?.[1] ?? '').trim()
      })
      index += 1
      continue
    }

    const unordered = line.match(/^(\s*)[-*]\s+(.+)$/u)
    if (unordered) {
      const items: Array<{ text: string; nested: boolean }> = []
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(/^(\s*)[-*]\s+(.+)$/u)
        if (!item?.[2]) break
        items.push({ text: item[2].trim(), nested: (item[1]?.length ?? 0) >= 2 })
        index += 1
      }
      blocks.push({ type: 'unordered-list', items })
      continue
    }

    const ordered = line.match(/^(\s*)\d+[.)]\s+(.+)$/u)
    if (ordered) {
      const items: Array<{ text: string; nested: boolean }> = []
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(/^(\s*)\d+[.)]\s+(.+)$/u)
        if (!item?.[2]) break
        items.push({ text: item[2].trim(), nested: (item[1]?.length ?? 0) >= 2 })
        index += 1
      }
      blocks.push({ type: 'ordered-list', items })
      continue
    }

    if (line.trimStart().startsWith('> ')) {
      const quote: string[] = []
      while (index < lines.length && (lines[index] ?? '').trimStart().startsWith('> ')) {
        quote.push((lines[index] ?? '').trimStart().slice(2))
        index += 1
      }
      blocks.push({ type: 'quote', text: quote.join(' ') })
      continue
    }

    const paragraph = [line.trim()]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (!next.trim() || /^\s*(?:#{2,3}\s+|\*\*.+\*\*\s*$|[-*]\s+|\d+[.)]\s+|>\s+|```)/u.test(next)) break
      paragraph.push(next.trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}

export function AgentMarkdown({ content }: { content: string }) {
  const blocks = useMemo(() => parseMarkdown(content), [content])
  return (
    <div className="agent-markdown">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`
        if (block.type === 'heading') {
          return block.level === 2
            ? <h2 key={key}>{inlineMarkdown(block.text)}</h2>
            : <h3 key={key}>{inlineMarkdown(block.text)}</h3>
        }
        if (block.type === 'unordered-list') {
          return <ul key={key}>{block.items.map((item, itemIndex) => <li className={item.nested ? 'is-nested' : undefined} key={`${itemIndex}-${item.text}`}>{inlineMarkdown(item.text)}</li>)}</ul>
        }
        if (block.type === 'ordered-list') {
          return <ol key={key}>{block.items.map((item, itemIndex) => <li className={item.nested ? 'is-nested' : undefined} key={`${itemIndex}-${item.text}`}>{inlineMarkdown(item.text)}</li>)}</ol>
        }
        if (block.type === 'quote') return <blockquote key={key}>{inlineMarkdown(block.text)}</blockquote>
        if (block.type === 'code') return <pre key={key}><code>{block.text}</code></pre>
        return <p key={key}>{inlineMarkdown(block.text)}</p>
      })}
    </div>
  )
}
