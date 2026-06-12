import React, { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

// Unique ID counter to avoid conflicts when multiple scanners mount
let scannerIdCounter = 0

export default function BarcodeScanner({ onScan, onClose, title = 'Scan barcode or QR code' }) {
  const [error, setError] = useState('')
  const [started, setStarted] = useState(false)
  const scannerRef = useRef(null)
  const containerIdRef = useRef(`qr-region-${++scannerIdCounter}`)

  useEffect(() => {
    const id = containerIdRef.current
    let scanner = null

    async function startScanner() {
      try {
        scanner = new Html5Qrcode(id)
        scannerRef.current = scanner

        // Get available cameras
        const devices = await Html5Qrcode.getCameras()
        // Prefer back camera
        const backCam = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[devices.length - 1]
        const cameraId = backCam?.id || { facingMode: 'environment' }

        await scanner.start(
          cameraId,
          {
            fps: 15,
            qrbox: (w, h) => ({
              width: Math.min(w * 0.8, 280),
              height: Math.min(h * 0.5, 160),
            }),
            aspectRatio: 1.5,
            formatsToSupport: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], // All formats incl QR
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          },
          (decoded) => {
            // Parse QR JSON if needed
            let code = decoded
            try {
              const parsed = JSON.parse(decoded)
              if (parsed.barcode) code = parsed.barcode
              else if (parsed.id) code = parsed.id
            } catch {}
            onScan(code)
          },
          () => {} // ignore intermediate failures silently
        )
        setStarted(true)
      } catch (err) {
        setError(
          err.name === 'NotAllowedError'
            ? 'Camera permission denied. Please allow camera access in your browser settings and try again.'
            : err.message?.includes('No cameras')
            ? 'No camera found on this device.'
            : `Could not start camera: ${err.message || err}`
        )
      }
    }

    startScanner()

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {})
        scannerRef.current = null
      }
    }
  }, [])

  return (
    <div>
      <style>{`
        #${containerIdRef.current} video { border-radius: 10px; }
        #${containerIdRef.current} { border-radius: 10px; overflow: hidden; }
      `}</style>

      {error ? (
        <div style={{ background: '#FCEBEB', border: '1px solid #fcc', borderRadius: 10, padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
          <div style={{ fontSize: 13, color: '#c62828', fontWeight: 500, marginBottom: 12 }}>{error}</div>
          <button onClick={onClose}
            style={{ padding: '8px 20px', background: '#0d1b2a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}>
            Close
          </button>
        </div>
      ) : (
        <>
          <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#000', marginBottom: 10 }}>
            <div id={containerIdRef.current} style={{ width: '100%' }} />
            {!started && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 13 }}>
                Starting camera…
              </div>
            )}
          </div>
          <div style={{ background: '#fff8f0', border: '1px solid #ffe0b2', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#854F0B', textAlign: 'center', marginBottom: 12 }}>
            📱 Works on iPhone Safari &amp; Android Chrome · Scans barcodes &amp; QR codes
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button onClick={onClose}
              style={{ padding: '8px 24px', background: '#f0f0f0', color: '#555', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
