/**
 * LocalDiscoveryModule.java
 *
 * Android native module wrapping NsdManager (Network Service Discovery)
 * for zero-infrastructure local peer discovery on the same Wi-Fi network.
 *
 * Provides the same API surface as the iOS LocalDiscoveryModule:
 * - startAdvertising: Registers a _picklejudge._tcp service
 * - stopAdvertising: Unregisters the service
 * - startBrowsing: Discovers nearby services
 * - stopBrowsing: Stops discovery
 *
 * Events emitted to React Native:
 * - onPeerFound: { name, address, port }
 * - onPeerLost: { name }
 */

package com.picklejudge;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.List;

public class LocalDiscoveryModule extends ReactContextBaseJavaModule {

    private static final String TAG = "LocalDiscovery";
    private static final String SERVICE_TYPE = "_picklejudge._tcp.";
    private static final String MODULE_NAME = "LocalDiscovery";

    private NsdManager nsdManager;
    private NsdManager.RegistrationListener registrationListener;
    private NsdManager.DiscoveryListener discoveryListener;
    private boolean isAdvertising = false;
    private boolean isBrowsing = false;

    public LocalDiscoveryModule(ReactApplicationContext reactContext) {
        super(reactContext);
        nsdManager = (NsdManager) reactContext.getSystemService(Context.NSD_SERVICE);
    }

    @NonNull
    @Override
    public String getName() {
        return MODULE_NAME;
    }

    // -------------------------------------------------------------------------
    // Advertising (Master)
    // -------------------------------------------------------------------------

    @ReactMethod
    public void startAdvertising(String serviceType, int port, String name) {
        if (isAdvertising) {
            Log.w(TAG, "Already advertising, stopping previous first");
            stopAdvertising();
        }

        NsdServiceInfo serviceInfo = new NsdServiceInfo();
        serviceInfo.setServiceName(name);
        serviceInfo.setServiceType(SERVICE_TYPE);
        serviceInfo.setPort(port);

        registrationListener = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo info) {
                isAdvertising = true;
                Log.i(TAG, "Service registered: " + info.getServiceName());
            }

            @Override
            public void onRegistrationFailed(NsdServiceInfo info, int errorCode) {
                Log.e(TAG, "Registration failed: errorCode=" + errorCode);
                isAdvertising = false;
            }

            @Override
            public void onServiceUnregistered(NsdServiceInfo info) {
                isAdvertising = false;
                Log.i(TAG, "Service unregistered: " + info.getServiceName());
            }

            @Override
            public void onUnregistrationFailed(NsdServiceInfo info, int errorCode) {
                Log.e(TAG, "Unregistration failed: errorCode=" + errorCode);
            }
        };

        nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener);
        Log.i(TAG, "Started advertising '" + name + "' on port " + port);
    }

    @ReactMethod
    public void stopAdvertising() {
        if (registrationListener != null && isAdvertising) {
            try {
                nsdManager.unregisterService(registrationListener);
            } catch (Exception e) {
                Log.w(TAG, "Failed to unregister service: " + e.getMessage());
            }
            isAdvertising = false;
        }
    }

    // -------------------------------------------------------------------------
    // Browsing (Slave)
    // -------------------------------------------------------------------------

    @ReactMethod
    public void startBrowsing(String serviceType) {
        if (isBrowsing) {
            Log.w(TAG, "Already browsing, stopping previous first");
            stopBrowsing();
        }

        discoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {
                isBrowsing = true;
                Log.i(TAG, "Discovery started for: " + serviceType);
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                Log.i(TAG, "Service found: " + serviceInfo.getServiceName());

                // Resolve the service to get IP address and port
                nsdManager.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo info, int errorCode) {
                        Log.e(TAG, "Resolve failed: " + errorCode);
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo info) {
                        InetAddress host = info.getHost();
                        int port = info.getPort();

                        Log.i(TAG, "Resolved: " + info.getServiceName() +
                                " at " + host.getHostAddress() + ":" + port);

                        // Emit event to React Native
                        WritableMap params = Arguments.createMap();
                        params.putString("name", info.getServiceName());
                        params.putString("address", host.getHostAddress());
                        params.putInt("port", port);

                        sendEvent("onPeerFound", params);
                    }
                });
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
                Log.i(TAG, "Service lost: " + serviceInfo.getServiceName());

                WritableMap params = Arguments.createMap();
                params.putString("name", serviceInfo.getServiceName());
                sendEvent("onPeerLost", params);
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
                isBrowsing = false;
                Log.i(TAG, "Discovery stopped for: " + serviceType);
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(TAG, "Discovery start failed: errorCode=" + errorCode);
                isBrowsing = false;
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(TAG, "Discovery stop failed: errorCode=" + errorCode);
            }
        };

        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
        Log.i(TAG, "Started browsing for peers");
    }

    @ReactMethod
    public void stopBrowsing() {
        if (discoveryListener != null && isBrowsing) {
            try {
                nsdManager.stopServiceDiscovery(discoveryListener);
            } catch (Exception e) {
                Log.w(TAG, "Failed to stop discovery: " + e.getMessage());
            }
            isBrowsing = false;
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Send an event to the React Native JS layer.
     */
    private void sendEvent(String eventName, @Nullable WritableMap params) {
        ReactApplicationContext context = getReactApplicationContext();
        if (context.hasActiveReactInstance()) {
            context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(eventName, params);
        }
    }

    /**
     * Get the local Wi-Fi IP address of this device.
     */
    @Nullable
    private String getLocalIPAddress() {
        try {
            List<NetworkInterface> interfaces = Collections.list(
                    NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface iface : interfaces) {
                if (iface.getName().equals("wlan0")) {
                    List<InetAddress> addrs = Collections.list(iface.getInetAddresses());
                    for (InetAddress addr : addrs) {
                        if (!addr.isLoopbackAddress() && addr.getHostAddress().indexOf(':') < 0) {
                            return addr.getHostAddress();
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to get local IP: " + e.getMessage());
        }
        return null;
    }
}
