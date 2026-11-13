/** Published anchors may outlive the headings that introduced them. Keep
 * compatibility here so retired topics do not stay in rendered/searchable prose. */
export const HELP_SECTION_ALIASES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  'app-tutorial': {
    '8-创作阅读工作台': '8-创作工作台',
    使用装机文档问答: '讨论与工作',
    附录快捷键速查: '快捷键速查',
    创作资料: '创作资源',
    待处理文档: '创作资源',
    '8-creation-reading-workspace': '8-creation-workspace',
    'asking-about-installed-pnds-documentation': 'discussion-and-work',
    'appendix-shortcut-quick-reference': 'shortcut-quick-reference',
    'creation-materials': 'creation-resources',
    'pending-documents': 'creation-resources',
  },
  'template-guide': {
    'pnds-template-创作指南': 'pnds-创作指南',
    '在-app-中从-blank-或-pnds-classic-新建工程': '新建-blank-工程',
    '外部-pnds-skills': '1-创建与初始化工程',
    'pnds-template-creators-guide': 'pnds-creators-guide',
    'creating-from-blank-or-pnds-classic-in-the-app': 'create-a-blank-project',
    'external-pnds-skills': '1-creating-and-initialising-a-project',
  },
  'readme-guide': {
    为什么值得写: '给工程写-readme',
    '双语-readme': 'readme-语言变体',
    在创作模式中编辑与交接: '在创作模式中编辑',
    'why-it-is-worth-writing': 'writing-a-project-readme',
    'bilingual-readmes': 'readme-language-variants',
    'editing-and-handing-off-in-creation-mode': 'editing-in-creation-mode',
  },
  'reference-structure': {
    'pnds-template-的结构': 'pnds-工程结构',
    'the-structure-of-a-pnds-template-project': 'pnds-project-structure',
  },
  'reference-page-interaction': {
    顶部标题条避让区: '指针与右键',
    键位安全区建议: 'monitor-页键盘',
    'the-top-title-strip-keep-out-zone': 'pointer-and-right-click',
    'key-choice-safety-zone': 'the-monitor-pages-keyboard',
  },
  'modules-readme': {
    'v161-离线标准模块': '默认基础与可选能力',
    刻意不收的模块: '默认基础与可选能力',
    时效: '采用与维护',
    'v161-offline-standard-modules':
      'default-foundation-and-optional-capabilities',
    'modules-deliberately-not-covered':
      'default-foundation-and-optional-capabilities',
    currency: 'adoption-and-maintenance',
  },
  'modules-audio': {
    三模式一个类: '音频模式',
    'template-作品层的示例语义': '应用与状态',
    'control-载荷这条缝上唯一的形状所有者': '应用与状态',
    恢复与路由的形状: '应用与状态',
    'three-modes-one-class': 'audio-modes',
    'the-template-work-layers-example-semantics': 'application-and-state',
    'the-control-payload-the-one-owner-of-its-shape-at-this-seam':
      'application-and-state',
    'the-shapes-of-recovery-and-routing': 'application-and-state',
  },
  'modules-locale-follow': {
    'v161-标准模块': '采用',
    'template-示例实现': '采用',
    'v161-standard-module': 'adoption',
    'template-example-implementation': 'adoption',
  },
  'modules-monitor-state': {
    'v161-标准模块': '默认接线',
    'template-示例实现': '共享状态',
    'v161-standard-module': 'default-wiring',
    'template-example-implementation': 'shared-state',
  },
  'modules-players': {
    乐手身份与座位: '默认身份',
    'v161-标准模块': '默认身份',
    'template-示例实现': '默认身份',
    'claim-token设备的持久身份': '默认身份',
    id1maxclients: '默认身份',
    两种恢复断线重连与工程重启: '恢复与释放',
    'monitor-的座位操作': '恢复与释放',
    'socketio-事件表': '连接与事件',
    页面侧publicclientjs: '连接与事件',
    'player-identity-and-seats': 'default-identity',
    'v161-standard-module': 'default-identity',
    'template-example-implementation': 'default-identity',
    'the-claim-token-a-devices-persistent-identity': 'default-identity',
    'the-id-1maxclients': 'default-identity',
    'two-kinds-of-recovery-reconnects-and-restarts': 'recovery-and-release',
    'the-monitors-seat-operations': 'recovery-and-release',
    'the-socketio-event-table': 'connections-and-events',
    'the-page-side-publicclientjs': 'connections-and-events',
  },
  'modules-qr': {
    'v161-标准模块': '邀请与有效状态',
    'template-示例实现': '邀请与有效状态',
    '端点get-qr只在-monitor-端': '邀请与有效状态',
    页面嵌法: '邀请与有效状态',
    创作者需要知道的事: '邀请与有效状态',
    'v161-standard-module': 'invitations-and-valid-state',
    'template-example-implementation': 'invitations-and-valid-state',
    'the-endpoint-get-qr-monitor-side-only': 'invitations-and-valid-state',
    'embedding-it-in-a-page': 'invitations-and-valid-state',
    'what-creators-should-know': 'invitations-and-valid-state',
  },
  'modules-theme-follow': {
    'v161-标准模块': '采用',
    'template-示例实现': '采用',
    'v161-standard-module': 'adoption',
    'template-example-implementation': 'adoption',
  },
}

export function resolveHelpSectionId(docId: string, sectionId: string): string {
  let decoded = sectionId
  try {
    decoded = decodeURIComponent(sectionId)
  } catch {
    // A malformed fragment remains unmatched rather than breaking navigation.
  }
  const aliases = Object.hasOwn(HELP_SECTION_ALIASES, docId)
    ? HELP_SECTION_ALIASES[docId]
    : undefined
  return aliases && Object.hasOwn(aliases, decoded)
    ? (aliases[decoded] ?? decoded)
    : decoded
}
