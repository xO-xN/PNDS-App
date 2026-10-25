/** Only a fresh, explicit creator command may switch a discussion into work.
 * Suggestions, questions, quotations and negative requests remain discussion. */
export function isProjectOrganizationRequest(input: string) {
  const text = input.trim()
  if (
    /[?？]|是否|要不要|是不是|能否|会怎样|只是(?:举例|讨论|示例)|别开始|先不开始|不需要(?:执行|开始)|吗[。！!\s]*$/u.test(
      text
    )
  )
    return false
  return (
    /^(?:(?:请(?:你)?\s*)?(?:帮我|替我|给我)|请(?:直接)?|现在(?:请)?|开始)\s*(?:按[^\n]{1,200}(?:规范|规则|文档)[^\n]{0,40})?整理[^\n]*(?:工程|项目|代码库)|^整理(?:一下)?(?:当前|这个|一下)?(?:工程|项目|代码库)/u.test(
      text
    ) ||
    /^(?:please\s+)?(?:help me\s+)?(?:organize|tidy(?: up)?|clean up)\s+(?:the\s+|this\s+|current\s+)*(?:project|codebase)\b/i.test(
      text
    )
  )
}
export function isHandoffRequest(input: string) {
  return (
    /^(?:(?:请|帮我|请帮我)\s*)?(?:生成|写|整理)(?:一份|成|为|一下)?(?:创作)?交接(?:文件|文档|草稿|单)[。！!\s]*$/u.test(
      input.trim()
    ) ||
    /^(?:please\s+)?(?:write|generate|prepare) (?:a |the )?handoff(?: draft| document| file)?[.!\s]*$/i.test(
      input.trim()
    )
  )
}
export function isStartWorkRequest(input: string) {
  return (
    /^(?:(?:请|帮我)\s*)?(?:开始工作|按(?:这个|上述|上面|已确认的)方案(?:开始)?(?:工作|实现|实施))[。！!\s]*$/u.test(
      input.trim()
    ) ||
    /^(?:please\s+)?(?:start work|implement (?:this|the confirmed) plan)[.!\s]*$/i.test(
      input.trim()
    )
  )
}
