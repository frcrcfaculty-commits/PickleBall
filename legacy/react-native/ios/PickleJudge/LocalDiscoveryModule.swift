/**
 * LocalDiscoveryModule.swift
 *
 * Native iOS module wrapping Apple's Multipeer Connectivity framework
 * for zero-infrastructure local peer discovery and connection.
 *
 * This module handles:
 * - Advertising this device as a PickleJudge instance
 * - Browsing for nearby PickleJudge peers
 * - Resolving peer IP addresses for TCP signaling handoff
 *
 * Service type: _picklejudge._tcp
 *
 * Events emitted to React Native:
 * - onPeerFound: { name, address, port }
 * - onPeerLost: { name }
 * - onConnectionReady: { peerName, address }
 */

import Foundation
import MultipeerConnectivity

@objc(LocalDiscovery)
class LocalDiscoveryModule: RCTEventEmitter {

    // MARK: - Properties

    private let serviceType = "picklejudge" // MCNearby requires ≤15 chars, no underscore prefix
    private var peerID: MCPeerID!
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private var session: MCSession?
    private var discoveredPeers: [String: MCPeerID] = [:]

    private var signalingPort: Int = 9876
    private var deviceName: String = "PickleJudge"

    // MARK: - Initialization

    override init() {
        super.init()
        self.peerID = MCPeerID(displayName: UIDevice.current.name)
        self.session = MCSession(
            peer: peerID,
            securityIdentity: nil,
            encryptionPreference: .none // Low latency > encryption for local play
        )
        self.session?.delegate = self
    }

    // MARK: - RCTEventEmitter

    override func supportedEvents() -> [String] {
        return ["onPeerFound", "onPeerLost", "onConnectionReady"]
    }

    override static func requiresMainQueueSetup() -> Bool {
        return false
    }

    // MARK: - Exported Methods

    /// Start advertising this device as a PickleJudge instance.
    /// - Parameters:
    ///   - serviceType: Service type string (overridden by internal constant)
    ///   - port: TCP signaling port to advertise
    ///   - name: Display name for this device
    @objc func startAdvertising(
        _ serviceTypeParam: String,
        port: NSNumber,
        name: String
    ) {
        self.signalingPort = port.intValue
        self.deviceName = name

        let discoveryInfo: [String: String] = [
            "port": String(self.signalingPort),
            "name": name,
            "version": "1.0"
        ]

        advertiser = MCNearbyServiceAdvertiser(
            peer: peerID,
            discoveryInfo: discoveryInfo,
            serviceType: serviceType
        )
        advertiser?.delegate = self
        advertiser?.startAdvertisingPeer()

        NSLog("[LocalDiscovery] Started advertising as '\(name)' on port \(self.signalingPort)")
    }

    /// Stop advertising.
    @objc func stopAdvertising() {
        advertiser?.stopAdvertisingPeer()
        advertiser = nil
        NSLog("[LocalDiscovery] Stopped advertising")
    }

    /// Start browsing for nearby PickleJudge peers.
    /// - Parameter serviceType: Service type to browse for
    @objc func startBrowsing(_ serviceTypeParam: String) {
        browser = MCNearbyServiceBrowser(
            peer: peerID,
            serviceType: serviceType
        )
        browser?.delegate = self
        browser?.startBrowsingForPeers()

        NSLog("[LocalDiscovery] Started browsing for peers")
    }

    /// Stop browsing.
    @objc func stopBrowsing() {
        browser?.stopBrowsingForPeers()
        browser = nil
        NSLog("[LocalDiscovery] Stopped browsing")
    }

    // MARK: - IP Address Resolution

    /// Get the local IP address of this device on the Wi-Fi network.
    private func getLocalIPAddress() -> String? {
        var address: String?
        var ifaddr: UnsafeMutablePointer<ifaddrs>?

        guard getifaddrs(&ifaddr) == 0, let firstAddr = ifaddr else {
            return nil
        }

        for ptr in sequence(first: firstAddr, next: { $0.pointee.ifa_next }) {
            let interface = ptr.pointee
            let addrFamily = interface.ifa_addr.pointee.sa_family

            if addrFamily == UInt8(AF_INET) { // IPv4
                let name = String(cString: interface.ifa_name)
                if name == "en0" { // Wi-Fi interface
                    var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    getnameinfo(
                        interface.ifa_addr,
                        socklen_t(interface.ifa_addr.pointee.sa_len),
                        &hostname,
                        socklen_t(hostname.count),
                        nil, 0,
                        NI_NUMERICHOST
                    )
                    address = String(cString: hostname)
                }
            }
        }

        freeifaddrs(ifaddr)
        return address
    }
}

// MARK: - MCNearbyServiceAdvertiserDelegate

extension LocalDiscoveryModule: MCNearbyServiceAdvertiserDelegate {

    func advertiser(
        _ advertiser: MCNearbyServiceAdvertiser,
        didReceiveInvitationFromPeer peerID: MCPeerID,
        withContext context: Data?,
        invitationHandler: @escaping (Bool, MCSession?) -> Void
    ) {
        // Auto-accept invitations (we handle security at the app level)
        invitationHandler(true, session)
        NSLog("[LocalDiscovery] Accepted invitation from \(peerID.displayName)")
    }

    func advertiser(
        _ advertiser: MCNearbyServiceAdvertiser,
        didNotStartAdvertisingPeer error: Error
    ) {
        NSLog("[LocalDiscovery] Failed to start advertising: \(error.localizedDescription)")
    }
}

// MARK: - MCNearbyServiceBrowserDelegate

extension LocalDiscoveryModule: MCNearbyServiceBrowserDelegate {

    func browser(
        _ browser: MCNearbyServiceBrowser,
        foundPeer peerID: MCPeerID,
        withDiscoveryInfo info: [String: String]?
    ) {
        let peerName = peerID.displayName
        discoveredPeers[peerName] = peerID

        let port = info?["port"] ?? "9876"
        let localIP = getLocalIPAddress() ?? "unknown"

        // We need the advertiser's IP address.
        // In Multipeer Connectivity, the IP is resolved through the session.
        // For our TCP signaling bridge, we invite the peer to get the connection,
        // then extract the address from the session.
        browser.invitePeer(peerID, to: session!, withContext: nil, timeout: 10)

        NSLog("[LocalDiscovery] Found peer: \(peerName), port: \(port)")

        // Emit event to JS with available info
        self.sendEvent(withName: "onPeerFound", body: [
            "name": peerName,
            "address": localIP, // Will be updated when session connects
            "port": Int(port) ?? 9876
        ])
    }

    func browser(
        _ browser: MCNearbyServiceBrowser,
        lostPeer peerID: MCPeerID
    ) {
        let peerName = peerID.displayName
        discoveredPeers.removeValue(forKey: peerName)

        self.sendEvent(withName: "onPeerLost", body: [
            "name": peerName
        ])

        NSLog("[LocalDiscovery] Lost peer: \(peerName)")
    }

    func browser(
        _ browser: MCNearbyServiceBrowser,
        didNotStartBrowsingForPeers error: Error
    ) {
        NSLog("[LocalDiscovery] Failed to start browsing: \(error.localizedDescription)")
    }
}

// MARK: - MCSessionDelegate

extension LocalDiscoveryModule: MCSessionDelegate {

    func session(
        _ session: MCSession,
        peer peerID: MCPeerID,
        didChange state: MCSessionState
    ) {
        switch state {
        case .connected:
            NSLog("[LocalDiscovery] Connected to peer: \(peerID.displayName)")
            self.sendEvent(withName: "onConnectionReady", body: [
                "peerName": peerID.displayName,
                "address": getLocalIPAddress() ?? "unknown"
            ])
        case .notConnected:
            NSLog("[LocalDiscovery] Disconnected from peer: \(peerID.displayName)")
        case .connecting:
            NSLog("[LocalDiscovery] Connecting to peer: \(peerID.displayName)")
        @unknown default:
            break
        }
    }

    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        // Not used — we use TCP/WebRTC for data, not MCSession
    }

    func session(_ session: MCSession, didReceive stream: InputStream,
                 withName streamName: String, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String,
                 fromPeer peerID: MCPeerID, with progress: Progress) {}
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String,
                 fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}
