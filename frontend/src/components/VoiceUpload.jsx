import { useState, useRef } from 'react';
import { Mic, Square, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const VoiceUpload = ({ onAudioSet }) => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [audioURL, setAudioURL] = useState('');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioURL(url);
        
        // Create a File object to send to the server
        const file = new File([blob], 'recording.webm', { type: 'audio/webm' });
        onAudioSet(file);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert(t('mic_error'));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      // Stop all tracks to release microphone
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAudioURL(URL.createObjectURL(file));
      onAudioSet(file);
    }
  };

  return (
    <div className={`voice-panel ${isRecording ? 'recording' : ''}`}>
      <h3 className="flex items-center gap-2" style={{ marginBottom: '6px', fontSize: '1rem' }}>
        <Mic size={19} color="var(--primary)" /> {t('voice_title')} <span className="form-note" style={{ fontFamily: 'inherit', fontWeight: 400 }}>{t('optional')}</span>
      </h3>
      <p className="form-note" style={{ marginBottom: '15px' }}>{t('voice_hint')}</p>
      
      <div className="flex gap-3 items-center voice-actions">
        {!isRecording ? (
          <button type="button" onClick={startRecording} className="secondary">
            <Mic size={18} /> {t('record_audio')}
          </button>
        ) : (
          <button type="button" onClick={stopRecording} className="record-pulse" style={{ backgroundColor: 'var(--danger)' }}>
            <Square size={18} /> {t('stop_recording')}
          </button>
        )}

        <div style={{ position: 'relative' }}>
          <input 
            type="file" 
            accept="audio/*" 
            onChange={handleFileChange}
            style={{ 
              position: 'absolute', 
              opacity: 0, 
              width: '100%', 
              height: '100%',
              cursor: 'pointer'
            }} 
          />
          <button type="button" className="secondary">
            <Upload size={18} /> {t('upload_file')}
          </button>
        </div>
      </div>

      {audioURL && (
        <div className="audio-preview">
          <audio src={audioURL} controls style={{ width: '100%', borderRadius: '0.5rem' }} />
        </div>
      )}
    </div>
  );
};

export default VoiceUpload;
