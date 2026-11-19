import Flutter
import PushKit
import UIKit
import flutter_callkit_incoming

/// iOS VoIP 푸시(PushKit) → CallKit 수신 화면.
/// iOS 는 VoIP 푸시를 받으면 즉시 CallKit 에 수신 전화를 보고해야 하므로
/// Flutter(Dart)가 뜨기 전에 여기서 바로 처리한다.
///
/// 백엔드가 보내는 VoIP 푸시 payload (Android FCM data 와 같은 키):
///   broadcast: { "type": "broadcast", "broadcastId": 1, "title": "...", "dial": "bcast-1" }
///   call:      { "type": "call", "caller": "20002", "callUuid": "<FreeSWITCH UUID>" }
/// extra 형식은 lib/services/callkit_ui.dart 의 showIncomingFromPush 와 맞춘다.
@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate, PKPushRegistryDelegate {
  private var voipRegistry: PKPushRegistry?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let registry = PKPushRegistry(queue: DispatchQueue.main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    voipRegistry = registry
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }

  // MARK: - PKPushRegistryDelegate

  func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate credentials: PKPushCredentials,
    for type: PKPushType
  ) {
    let token = credentials.token.map { String(format: "%02x", $0) }.joined()
    // Dart 에서 FlutterCallkitIncoming.getDevicePushTokenVoIP() 로 읽어 백엔드에 등록
    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.setDevicePushTokenVoIP(token)
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.setDevicePushTokenVoIP("")
  }

  func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    guard type == .voIP else {
      completion()
      return
    }
    let p = payload.dictionaryPayload
    let data: flutter_callkit_incoming.Data

    if (p["type"] as? String) == "broadcast" {
      let title = p["title"] as? String ?? ""
      data = flutter_callkit_incoming.Data(
        id: UUID().uuidString,
        nameCaller: "마을방송: \(title)",
        handle: "마을방송",
        type: 0
      )
      data.extra = [
        "kind": "broadcast",
        "broadcastId": "\(p["broadcastId"] ?? "")",
        "dial": "\(p["dial"] ?? "")",
        "title": title,
      ] as NSDictionary
    } else {
      // 1:1 통화. 알 수 없는 type 이어도 VoIP 푸시는 반드시 수신 화면으로 이어져야 한다.
      let caller = p["caller"] as? String ?? "알 수 없음"
      let callUuid = p["callUuid"] as? String ?? ""
      data = flutter_callkit_incoming.Data(
        id: UUID(uuidString: callUuid) != nil ? callUuid : UUID().uuidString,
        nameCaller: caller,
        handle: caller,
        type: 0
      )
      data.extra = ["kind": "call", "caller": caller] as NSDictionary
    }
    data.appName = "마을방송"
    data.duration = 40000
    data.supportsVideo = false
    data.supportsDTMF = true
    data.supportsHolding = false
    data.audioSessionMode = "voiceChat"

    SwiftFlutterCallkitIncomingPlugin.sharedInstance?.showCallkitIncoming(data, fromPushKit: true) {
      completion()
    }
  }
}
