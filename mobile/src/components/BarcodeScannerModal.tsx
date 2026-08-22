/**
 * Full-screen modal that shows the camera and returns a scanned barcode.
 * Requests camera permission on first mount and shows a permission-denied
 * fallback if refused.
 *
 * The barcode-scanned callback fires exactly ONCE per open (we lock with a
 * ref after the first hit so continuous scanning doesn't spam the parent
 * with duplicates).
 */

import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { X, ScanBarcode } from 'lucide-react-native';

interface BarcodeScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

export function BarcodeScannerModal({
  visible,
  onClose,
  onScan,
}: BarcodeScannerModalProps): React.JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const seenRef = useRef<boolean>(false);

  // Ask for permission the first time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    seenRef.current = false;
    setErrorMsg(null);
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [visible, permission, requestPermission]);

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <View className="flex-1 bg-black">
        <View className="absolute left-0 right-0 top-0 z-10 flex-row items-center justify-between px-4 pt-14 pb-3">
          <View className="flex-row items-center gap-2">
            <ScanBarcode size={20} color="#fff" />
            <Text className="text-base font-semibold text-white">Scan a barcode</Text>
          </View>
          <Pressable onPress={onClose} className="rounded-full bg-white/10 p-2 active:bg-white/20">
            <X size={20} color="#fff" />
          </Pressable>
        </View>

        {!permission ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-center text-slate-400">Checking camera permission…</Text>
          </View>
        ) : !permission.granted ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-center text-base text-slate-300">
              Camera permission is required to scan barcodes.
            </Text>
            {permission.canAskAgain ? (
              <Pressable
                onPress={requestPermission}
                className="mt-4 rounded-xl bg-cobalt-600 px-4 py-2.5 active:bg-cobalt-700"
              >
                <Text className="text-base font-medium text-white">Grant permission</Text>
              </Pressable>
            ) : (
              <Text className="mt-2 text-center text-xs text-slate-500">
                Enable "Camera" for Expo Go in Settings → Apps → Expo Go → Permissions.
              </Text>
            )}
          </View>
        ) : (
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'code93', 'upc_a', 'upc_e', 'qr'],
            }}
            onBarcodeScanned={(evt) => {
              if (seenRef.current) return;
              seenRef.current = true;
              onScan(evt.data);
            }}
            onMountError={(err) => setErrorMsg(err.message ?? 'Camera failed to start.')}
          >
            <View className="absolute left-8 right-8 top-1/2 -translate-y-24 h-48 rounded-2xl border-2 border-white/60" />
            <View className="absolute bottom-16 left-0 right-0 items-center">
              <Text className="text-sm text-white/80">Point the camera at a product barcode</Text>
            </View>
          </CameraView>
        )}

        {errorMsg && (
          <View className="absolute bottom-8 left-6 right-6 rounded-xl bg-rose-500/20 p-3">
            <Text className="text-sm text-rose-100">{errorMsg}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}
