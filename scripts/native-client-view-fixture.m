#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/message.h>
#import <dlfcn.h>

static void SyncFinished(void *context) {
  void (^done)(void)=(__bridge_transfer id)context; done();
}

@interface LocalShell : NSObject <WKURLSchemeHandler>
@end
@implementation LocalShell
- (void)webView:(WKWebView *)view startURLSchemeTask:(id<WKURLSchemeTask>)task {
  NSData *data=[@"<html><body><h1>PNDS fixture shell</h1><button>Close</button></body></html>" dataUsingEncoding:NSUTF8StringEncoding];
  [task didReceiveResponse:[[NSURLResponse alloc]initWithURL:task.request.URL MIMEType:@"text/html" expectedContentLength:data.length textEncodingName:@"utf-8"]];
  [task didReceiveData:data];[task didFinish];
}
- (void)webView:(WKWebView *)view stopURLSchemeTask:(id<WKURLSchemeTask>)task {}
@end


// Explicit paths are private to this fixture, including during same-process recreation.
static WKWebsiteDataStore *CreateStore(NSString *directory, NSString *hostname, NSString *proxyPort) {
  id config=[[NSClassFromString(@"_WKWebsiteDataStoreConfiguration") alloc]init];
  NSDictionary *paths=@{@"_setWebStorageDirectory:":@"LocalStorage",@"_setIndexedDBDatabaseDirectory:":@"IndexedDB",@"setGeneralStorageDirectory:":@"Storage",@"_setCookieStorageFile:":@"Cookies.binarycookies",@"setNetworkCacheDirectory:":@"Cache",@"_setResourceLoadStatisticsDirectory:":@"Statistics"};
  for(NSString *key in paths){void (*setter)(id,SEL,id)=(void *)objc_msgSend;setter(config,NSSelectorFromString(key),[NSURL fileURLWithPath:[directory stringByAppendingPathComponent:paths[key]]]);}
  NSString *pac=[NSString stringWithFormat:@"function FindProxyForURL(url,host){if(host==='%@')return 'PROXY 127.0.0.1:%@';return 'DIRECT';}",hostname,proxyPort];
  [config setValue:@{@"ProxyAutoConfigEnable":@1,@"ProxyAutoConfigJavaScript":pac,@"ExceptionsList":@[],@"ExcludeSimpleHostnames":@NO} forKey:@"proxyConfiguration"];
  id (*send)(id,SEL,id)=(void *)objc_msgSend;return send([WKWebsiteDataStore alloc],NSSelectorFromString(@"_initWithConfiguration:"),config);
}

// A controller changes only native admission; this probe never navigates again.
// Results include real document memory and timeOrigin, not the WKWebView pointer.
static void StartContinuityProbe(WKWebView *view, NSString *directory) {
  __block NSNumber *completed=nil;
  __block BOOL busy=NO;
  [NSTimer scheduledTimerWithTimeInterval:0.02 repeats:YES block:^(NSTimer *timer) {
    if(busy || view.loading)return;
    NSData *bytes=[NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:@"continuity-command.json"]];
    NSDictionary *command=bytes?[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil]:nil;
    NSNumber *identity=command[@"id"];
    if(!identity || [identity isEqual:completed])return;
    if([command[@"finish"] boolValue]) {
      void (*closeDocument)(id,SEL)=(void *)objc_msgSend;
      closeDocument(view,NSSelectorFromString(@"_close"));
      BOOL (*isClosed)(id,SEL)=(void *)objc_msgSend;
      if(!isClosed(view,NSSelectorFromString(@"_isClosed"))){fprintf(stderr,"FAIL continuity document did not close\n");exit(1);}
      [@"closed" writeToFile:[directory stringByAppendingPathComponent:@"continuity-closed"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
      printf("PASS continuous native document explicitly closed\n");fflush(stdout);exit(0);
    }
    busy=YES;
    NSString *script=@"if(!window.scoreToken)throw new Error('score is not ready');const before=window.scoreTicks;await new Promise(resolve=>setTimeout(resolve,80));const response=await fetch('/continuity-check?step='+step);return {token:window.scoreToken,ticks:window.scoreTicks,previousTicks:before,timeOrigin:performance.timeOrigin,stored:localStorage.getItem('continuity'),status:response.status,top:top===self,media:typeof navigator.mediaDevices?.getUserMedia==='function'};";
    [view callAsyncJavaScript:script arguments:@{@"step":identity} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id result,NSError *error) {
      busy=NO;
      if(error){fprintf(stderr,"continuity probe: %s\n",error.localizedDescription.UTF8String);return;}
      NSData *encoded=[NSJSONSerialization dataWithJSONObject:@{@"id":identity,@"result":result} options:0 error:nil];
      [encoded writeToFile:[directory stringByAppendingPathComponent:@"continuity-result.json"] atomically:YES];
      completed=identity;
    }];
  }];
}

@interface ChildProbe : NSObject <WKScriptMessageHandler>
@property NSWindow *window;
@property WKWebView *shell;
@property WKWebView *child;
@property WKWebsiteDataStore *store;
@property BOOL read;
@property BOOL isolated;
@property NSString *directory;
@property NSString *hostname;
@property NSString *virtualPort;
@property NSString *nextPort;
@end
@implementation ChildProbe
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
  NSData *data=[NSJSONSerialization dataWithJSONObject:message.body options:0 error:nil];
  printf("%s\n",[[[NSString alloc]initWithData:data encoding:NSUTF8StringEncoding] UTF8String]);fflush(stdout);
  NSDictionary *body=message.body;
  double expectedWidth=self.read?448:560;
  double expectedZoom=self.read?1.25:1;
  if ([body[@"viewportWidth"] doubleValue]!=expectedWidth || self.child.pageZoom!=expectedZoom) {fprintf(stderr,"FAIL native viewport/pageZoom mismatch\n");exit(1);}
  printf("PASS native viewport %.0f CSS pixels at %.2f pageZoom\n",expectedWidth,expectedZoom);fflush(stdout);
  if (![body[@"poll"] isEqual:@"ok"] || ![body[@"worker"] isEqual:@"worker-ready"] || ![body[@"echo"] isEqual:@"echo:hello"] || ![body[@"top"] isEqual:@YES] || ![body[@"secure"] isEqual:@YES]) {fprintf(stderr,"FAIL child transport evidence\n");exit(1);}
  // Inspect exposure only: calling getUserMedia would request device permission.
  if (![body[@"mediaDevicesExposed"] isEqual:@YES] || ![body[@"getUserMediaExposed"] isEqual:@YES]) {fprintf(stderr,"FAIL media capture APIs not exposed in secure first-party child\n");exit(1);}
  printf("PASS media capture APIs exposed without capture\n");fflush(stdout);
  if (self.isolated) {
    if (![body[@"claim"] isKindOfClass:[NSNull class]] || ![body[@"seat"] isKindOfClass:[NSNull class]] || ![body[@"cookie"] isEqual:@""] || ![body[@"writerTick"] isKindOfClass:[NSNull class]] || ![body[@"writerAck"] isEqual:@0]) {fprintf(stderr,"FAIL isolated origin inherited storage\n");exit(1);}
    printf("PASS isolated host/project origin has no old localStorage IndexedDB or cookies\n");exit(0);
  }
  if (![body[@"claim"] isEqual:@"retained-token"] || ![body[@"seat"] isEqual:@7] || ![body[@"cookie"] containsString:@"seat=7"] || ![body[@"server"] isEqual:self.read?@"second":@"first"]) {fprintf(stderr,"FAIL child storage evidence\n");exit(1);}
  if(self.read && (![body[@"writerStable"] isEqual:@YES] || [body[@"writerAck"] intValue]<4)) {fprintf(stderr,"FAIL last acknowledged writer value was not stable after close\n");exit(1);}
  if(!self.read && [body[@"writerTick"] intValue]<4) {fprintf(stderr,"FAIL continuous writer did not run\n");exit(1);}
  if(self.read && self.nextPort){printf("PASS same-process native view and data store recreation retain all storage across proxy ports\n");exit(0);}
  if(self.read){printf("PASS embedded firstparty native view restores localStorage IndexedDB cookies across separate process and occupied virtual port\n");exit(0);}
  // Capture the store, destroy the document (including its active writer),
  // then synchronize its final writes. Hiding the view is not a write barrier.
  WKWebsiteDataStore *retainedStore=self.store;
  SEL closeSelector=NSSelectorFromString(@"_close");
  SEL closedSelector=NSSelectorFromString(@"_isClosed");
  if (![self.child respondsToSelector:closeSelector] || ![self.child respondsToSelector:closedSelector]) {fprintf(stderr,"FAIL native close unavailable\n");exit(1);}
  void (*closeDocument)(id,SEL)=(void *)objc_msgSend;
  BOOL (*closed)(id,SEL)=(void *)objc_msgSend;
  closeDocument(self.child,closeSelector);
  if (!closed(self.child,closedSelector)) {fprintf(stderr,"FAIL native document not closed\n");exit(1);}
  [self.child removeFromSuperview];self.child=nil;self.store=nil;
  printf("CLOSED continuous writer document before final synchronization\n");fflush(stdout);
  dispatch_async(dispatch_get_main_queue(),^{
    void (*sync)(const void *,void *,void (*)(void *))=dlsym(RTLD_DEFAULT,"WKWebsiteDataStoreSyncLocalStorage");
    if (!sync) {fprintf(stderr,"FAIL localStorage sync API unavailable\n");exit(1);}
    void (^afterSync)(void)=^{
      void (*closeStatistics)(id,SEL,id)=(void *)objc_msgSend;
      closeStatistics(retainedStore,NSSelectorFromString(@"_closeDatabases:"),^{
        if (!self.nextPort) {printf("WRITTEN storage flushed\n");fflush(stdout);exit(0);}
        self.read=YES;
        dispatch_async(dispatch_get_main_queue(),^{
          self.store=CreateStore(self.directory,self.hostname,self.nextPort);
          WKWebViewConfiguration *configuration=[WKWebViewConfiguration new];configuration.websiteDataStore=self.store;[configuration.userContentController addScriptMessageHandler:self name:@"result"];
          self.child=[[WKWebView alloc]initWithFrame:NSMakeRect(80,60,560,350) configuration:configuration];[self.window.contentView addSubview:self.child];
          self.child.pageZoom=1.25;
          [self.child loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:[NSString stringWithFormat:@"http://%@:%@/?phase=read",self.hostname,self.virtualPort]]]];
        });
      });
    };
    sync((__bridge const void *)retainedStore,(__bridge_retained void *)[afterSync copy],SyncFinished);
  });
}
@end

int main(int argc,const char **argv){@autoreleasepool{
  if(argc!=6 && argc!=7)return 2;
  [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  NSString *proxyPort=[NSString stringWithUTF8String:argv[1]], *virtualPort=[NSString stringWithUTF8String:argv[2]], *directory=[NSString stringWithUTF8String:argv[3]], *phase=[NSString stringWithUTF8String:argv[4]];
  NSString *hostname=[NSString stringWithUTF8String:argv[5]];
  ChildProbe *probe=[ChildProbe new];probe.directory=directory;probe.hostname=hostname;probe.virtualPort=virtualPort;probe.nextPort=argc==7?[NSString stringWithUTF8String:argv[6]]:nil;probe.read=[phase isEqual:@"read"];probe.isolated=[phase isEqual:@"isolate"];
  probe.store=CreateStore(directory,hostname,proxyPort);
  WKWebViewConfiguration *shellConfig=[WKWebViewConfiguration new];[shellConfig setURLSchemeHandler:[LocalShell new] forURLScheme:@"tauri"];
  probe.shell=[[WKWebView alloc]initWithFrame:NSMakeRect(0,0,640,480) configuration:shellConfig];
  probe.window=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,640,480) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  NSView *container=[[NSView alloc]initWithFrame:NSMakeRect(0,0,640,480)];probe.window.contentView=container;[container addSubview:probe.shell];
  [probe.shell loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"tauri://localhost/"]]];
  WKWebViewConfiguration *childConfig=[WKWebViewConfiguration new];childConfig.websiteDataStore=probe.store;[childConfig.userContentController addScriptMessageHandler:probe name:@"result"];
  probe.child=[[WKWebView alloc]initWithFrame:NSMakeRect(80,60,560,350) configuration:childConfig];[container addSubview:probe.child];
  probe.child.pageZoom=probe.read?1.25:1;
  [probe.child loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:[NSString stringWithFormat:@"http://%@:%@/?phase=%@",hostname,virtualPort,phase]]]];
  if([phase isEqual:@"continuity"]){probe.window.title=@"PNDS Client continuity test";[probe.window orderFront:nil];StartContinuityProbe(probe.child,directory);}
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,15*NSEC_PER_SEC),dispatch_get_main_queue(),^{fprintf(stderr,"FAIL deadline\n");exit(1);});
  [NSApp run];
}}
