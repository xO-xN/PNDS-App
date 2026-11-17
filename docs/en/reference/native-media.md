# Native Pages and Media

## Native Host monitor and creation performer media

The macOS App uses native documents for the current project's main monitor, projection and creation performer tests. Resources, Workers and connections are limited to managed origins and declared project services. Pages have no Tauri management permissions. Native pages can request capture at HTTP venues. Ordinary browsers apply their [secure-context and permission requirements](./https.md).

The App provides a read-only hint at document start.

```js
globalThis.PNDS_MEDIA_SURFACE
// { role: 'monitor' | 'projection' | 'performer', captureAllowed: boolean }
```

The main monitor owns capture and analysis. Projection has `surface=venue` and `captureAllowed: false`. Native permissions block capture there. Skip capture and inference there and subscribe to main monitor results through the project's own communication. Performers and Clients can manually enable their inputs.

Each page provides manual enablement, input selection and retry. WebKit/macOS permission applies to the current document and origin. The system determines whether an input can be shared. A failure preserves capture in other pages.

Release the page's media, analysis, Workers and connections on close, refresh, successful replacement or exit. Stop streams that arrive after the page has ended. Hiding or a temporary disconnection preserves the page.
