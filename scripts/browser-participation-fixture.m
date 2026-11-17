// A plain WebKit browser fixture: no proxy, injected request headers, extension,
// App IPC, or replacement HTTP server. JavaScript drives the public entry UI.
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <string.h>

@interface BrowserProbe : NSObject <WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler>
@property NSWindow *window;
@property WKWebView *view;
@property NSString *script;
@property NSString *directory;
@property BOOL started;
@property NSString *promptAnswer;
@end
@implementation BrowserProbe
- (void)webView:(WKWebView *)view runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt defaultText:(NSString *)defaultText initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSString *))completionHandler {
  completionHandler(self.promptAnswer);
}
- (void)webView:(WKWebView *)view runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
  completionHandler();
}
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {
  if (self.started) return;
  self.started = YES;
  [view callAsyncJavaScript:self.script arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id result, NSError *error) {
    if (error) { fprintf(stderr, "FAIL browser script: %s\n", error.description.UTF8String); exit(1); }
    NSData *json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingFragmentsAllowed error:nil];
    printf("%s\n", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
    fflush(stdout);
    exit(0);
  }];
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
  NSDictionary *body = message.body;
  NSString *phase = body[@"phase"];
  if (![phase isKindOfClass:NSString.class] || [phase rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyz0123456789-"] invertedSet]].location != NSNotFound) { exit(2); }
  if ([phase isEqual:@"prompt-answer"]) {
    self.promptAnswer = body[@"answer"];
    return;
  }
  if ([phase isEqual:@"page-error"]) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    fprintf(stderr, "PAGE %s\n", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
    return;
  }
  if ([phase isEqual:@"input"]) {
    [self.window makeFirstResponder:self.view];
    NSEvent *key = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:self.window.windowNumber context:nil characters:@"k" charactersIgnoringModifiers:@"k" isARepeat:NO keyCode:40];
    [self.view keyDown:key];
    return;
  }
  NSData *json = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
  [json writeToFile:[self.directory stringByAppendingPathComponent:[phase stringByAppendingString:@".json"]] atomically:YES];
}
- (void)webView:(WKWebView *)view didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  fprintf(stderr, "FAIL browser navigation: %s\n", error.description.UTF8String); exit(1);
}
@end
int main(int argc, const char **argv) { @autoreleasepool {
  if (argc != 4 && argc != 5) return 2;
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  BrowserProbe *probe = [BrowserProbe new];
  probe.script = [[NSString stringWithContentsOfFile:[NSString stringWithUTF8String:argv[2]] encoding:NSUTF8StringEncoding error:nil] stringByAppendingString:@"\nreturn await verifyBrowserEntry();"];
  probe.directory = [NSString stringWithUTF8String:argv[3]];
  WKWebViewConfiguration *config = [WKWebViewConfiguration new];
  config.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
  [config.userContentController addScriptMessageHandler:probe name:@"result"];
  NSString *diagnostics = @"addEventListener('error',e=>webkit.messageHandlers.result.postMessage({phase:'page-error',url:location.href,message:e.message||'Resource failed',resource:e.target?.src||e.target?.href||''}),true);addEventListener('unhandledrejection',e=>webkit.messageHandlers.result.postMessage({phase:'page-error',url:location.href,message:String(e.reason)}));";
  [config.userContentController addUserScript:[[WKUserScript alloc] initWithSource:diagnostics injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:NO]];
  probe.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  probe.view = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 800, 600) configuration:config];
  probe.view.navigationDelegate = probe;
  probe.view.UIDelegate = probe;
  [probe.window.contentView addSubview:probe.view];
  if (argc == 5 && strcmp(argv[4], "--visible") == 0) {
    [probe.window makeKeyAndOrderFront:nil];
    [probe.window orderFrontRegardless];
    [NSApp activateIgnoringOtherApps:YES];
  }
  [probe.view loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:[NSString stringWithUTF8String:argv[1]]]]];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 90 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ fprintf(stderr, "FAIL browser deadline\n"); exit(1); });
  [NSApp run];
} }
