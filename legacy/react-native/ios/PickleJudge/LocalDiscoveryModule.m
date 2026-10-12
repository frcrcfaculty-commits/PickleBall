// LocalDiscoveryModule.m
// React Native bridge header for the Swift LocalDiscoveryModule

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(LocalDiscovery, RCTEventEmitter)

RCT_EXTERN_METHOD(startAdvertising:(NSString *)serviceType
                  port:(nonnull NSNumber *)port
                  name:(NSString *)name)

RCT_EXTERN_METHOD(stopAdvertising)

RCT_EXTERN_METHOD(startBrowsing:(NSString *)serviceType)

RCT_EXTERN_METHOD(stopBrowsing)

@end
