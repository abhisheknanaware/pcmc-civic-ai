import React, { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Camera, X, Check, RefreshCw, SwitchCamera, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const WebcamUpload = ({ onCapture }) => {
  const { t } = useTranslation();
  const webcamRef = useRef(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [facingMode, setFacingMode] = useState("environment");

  // Convert base64 data URL to a File object for formData
  const dataURLtoFile = (dataurl, filename) => {
    let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
    bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, {type:mime});
  };

  const capturePhoto = useCallback(() => {
    const imageSrc = webcamRef.current.getScreenshot();
    if (imageSrc) {
      setPhotoDataUrl(imageSrc);
      const file = dataURLtoFile(imageSrc, 'webcam-capture.jpg');
      onCapture(file);
      setIsCameraOpen(false);
    }
  }, [webcamRef, onCapture]);

  const handleFileSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setPhotoDataUrl(URL.createObjectURL(file));
    onCapture(file);
  };

  const clearPhoto = () => {
    setPhotoDataUrl(null);
    onCapture(null);
  };

  return (
    <div style={{ marginTop: '24px' }}>
      <label>{t('photo_label')} <span className="form-note">{t('optional')}</span></label>
      
      {!isCameraOpen && !photoDataUrl && (
        <div style={{ display: 'flex', gap: '12px' }}>
           <button 
             type="button" 
             onClick={() => setIsCameraOpen(true)} 
             style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 16px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '12px', cursor: 'pointer', flex: 1, justifyContent: 'center', color: 'var(--primary)', fontWeight: 'bold', fontSize: '15px' }}
           >
              <Camera size={20} /> {t('open_camera')}
           </button>
           <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 16px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '12px', cursor: 'pointer', flex: 1, justifyContent: 'center', color: '#475569', fontWeight: 'bold', fontSize: '15px' }}>
              <Upload size={20} /> {t('upload_file')}
              <input 
                type="file" 
                accept="image/*" 
                capture="environment"
                onChange={handleFileSelect} 
                style={{ display: 'none' }} 
              />
           </label>
        </div>
      )}

      {isCameraOpen && (
        <div style={{ background: '#0f172a', borderRadius: '16px', overflow: 'hidden', marginTop: '16px', position: 'relative', border: '4px solid #1e293b', display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ padding: '12px 16px', background: '#1e293b', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', background: '#ef4444', borderRadius: '50%', boxShadow: '0 0 8px #ef4444' }}></div> {t('live_feed')}
            </span>
            <button type="button" aria-label={t('close')} onClick={() => setIsCameraOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex' }}>
              <X size={20} />
            </button>
          </div>

          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            videoConstraints={{ facingMode }}
            style={{ width: '100%', minHeight: '300px', objectFit: 'cover', display: 'block', background: '#000' }}
          />

          <div style={{ padding: '16px', background: '#1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <button 
                type="button" 
                onClick={() => setFacingMode(prev => prev === "user" ? "environment" : "user")} 
                style={{ padding: '12px 16px', background: '#334155', color: 'white', border: 'none', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', cursor: 'pointer' }}
             >
               <SwitchCamera size={18}/> {t('flip_camera')}
             </button>
             
             <button 
                type="button" 
                onClick={capturePhoto} 
                style={{ padding: '12px 32px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '99px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)' }}
             >
               <Camera size={20}/> {t('capture_photo')}
             </button>
             <div style={{ width: '60px' }}></div> {/* Spacer to center the capture button */}
          </div>
        </div>
      )}

      {photoDataUrl && (
        <div style={{ position: 'relative', marginTop: '16px', borderRadius: '16px', overflow: 'hidden', border: '2px solid #22c55e', background: '#f0fdf4', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
             <span style={{ color: '#166534', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
               <Check size={18} color="#22c55e" /> {t('photo_ready')}
             </span>
             <button type="button" onClick={clearPhoto} style={{ padding: '8px 16px', background: 'white', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                <RefreshCw size={14}/> {t('retake')}
             </button>
          </div>
          <img src={photoDataUrl} alt="Captured" style={{ width: '100%', maxHeight: '350px', objectFit: 'cover', display: 'block', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
        </div>
      )}
    </div>
  );
};

export default WebcamUpload;
