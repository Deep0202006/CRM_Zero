"use client";

import { useState, useRef, useEffect } from "react";
import { Camera, Image as ImageIcon, X } from "lucide-react";
import { compressSelfie } from "@/lib/imageCompression";

interface SelfieCaptureProps {
  onCapture: (blob: Blob | null) => void;
  existingPhotoUrl?: string | null;
}

export default function SelfieCapture({ onCapture, existingPhotoUrl }: SelfieCaptureProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingPhotoUrl || null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Robust cleanup of video tracks
  const stopTracks = (currentStream: MediaStream | null) => {
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
    }
  };

  useEffect(() => {
    return () => {
      stopTracks(stream); // Cleanup on unmount
    };
  }, [stream]);

  // Cleanup object URLs on unmount or previewUrl change
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl !== existingPhotoUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl, existingPhotoUrl]);

  // Attach stream after video element is rendered
  useEffect(() => {
    if (isCameraActive && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [isCameraActive, stream]);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" } // prefer front camera
      });
      setStream(mediaStream);
      setIsCameraActive(true);
    } catch (err) {
      console.error("Camera access denied or unavailable", err);
      // Fallback to file input if camera is completely blocked/missing
      fileInputRef.current?.click();
    }
  };

  const stopCamera = () => {
    stopTracks(stream);
    setStream(null);
    setIsCameraActive(false);
  };

  const processAndSetImage = async (fileOrBlob: File | Blob) => {
    try {
      const file = fileOrBlob instanceof File
        ? fileOrBlob
        : new File([fileOrBlob], "selfie.jpg", { type: "image/jpeg" });

      const compressed = await compressSelfie(file);

      if (previewUrl && previewUrl !== existingPhotoUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }

      const newPreviewUrl = URL.createObjectURL(compressed);
      setPreviewUrl(newPreviewUrl);
      onCapture(compressed);
    } catch (error) {
      console.error("Error compressing image:", error);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && stream) {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");

      const MAX_WIDTH = 800;
      const MAX_HEIGHT = 800;
      let width = video.videoWidth;
      let height = video.videoHeight;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) {
            processAndSetImage(blob).then(() => stopCamera());
          }
        }, "image/jpeg", 1.0); // Pass uncompressed to compressSelfie
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processAndSetImage(file);
    }
  };

  const clearPhoto = () => {
    if (previewUrl && previewUrl !== existingPhotoUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    onCapture(null);
    stopCamera();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (previewUrl) {
    return (
      <div className="relative w-full h-64 bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
        <img src={previewUrl} alt="Selfie Preview" className="w-full h-full object-cover" />
        <button
          type="button"
          onClick={clearPhoto}
          className="absolute top-2 right-2 p-2 bg-slate-900/60 text-white rounded-full hover:bg-slate-900 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    );
  }

  if (isCameraActive) {
    return (
      <div className="relative w-full h-64 bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
          <button
            type="button"
            onClick={stopCamera}
            className="p-3 bg-white/20 text-white rounded-full hover:bg-white/30 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={capturePhoto}
            className="p-3 bg-brand-500 text-white rounded-full hover:bg-brand-600 shadow-lg transition-colors"
          >
            <Camera className="w-6 h-6" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={startCamera}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium transition-colors"
        >
          <Camera className="w-5 h-5 text-slate-500" />
          <span>Take Photo</span>
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 transition-colors"
          title="Upload from device"
        >
          <ImageIcon className="w-5 h-5" />
        </button>
      </div>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/*"
        capture="user"
        className="hidden"
      />
    </div>
  );
}
