"use client";

import { useState, useRef } from "react";
import { Camera, Image as ImageIcon, X } from "lucide-react";
import Image from "next/image";

interface SelfieCaptureProps {
  onCapture: (blob: Blob | null) => void;
  existingPhotoUrl?: string | null;
}

export default function SelfieCapture({ onCapture, existingPhotoUrl }: SelfieCaptureProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingPhotoUrl || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processAndSetImage = (fileOrBlob: File | Blob) => {
    const url = URL.createObjectURL(fileOrBlob);
    
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const MAX_WIDTH = 800;
      const MAX_HEIGHT = 800;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          width = Math.round(width);
          height = MAX_HEIGHT;
        }
      }
      
      width = Math.round(width);
      height = Math.round(height);

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      
      // Auto-rotate fixing is typically handled by modern browsers for input files,
      // but we just draw it cleanly here.
      ctx?.drawImage(img, 0, 0, width, height);

      // Compress to JPEG ~200kb (0.7 quality usually does it)
      canvas.toBlob((blob) => {
        if (blob) {
          setPreviewUrl(URL.createObjectURL(blob));
          onCapture(blob);
        }
      }, "image/jpeg", 0.7);
    };
    img.src = url;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processAndSetImage(file);
    }
    // Reset value so same file can be selected again if needed
    if (e.target) {
      e.target.value = "";
    }
  };

  const clearPhoto = () => {
    setPreviewUrl(null);
    onCapture(null);
  };

  if (previewUrl) {
    return (
      <div className="relative w-full h-64 bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
        <Image src={previewUrl} alt="Selfie Preview" fill className="object-cover" unoptimized />
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

  return (
    <div className="w-full">
      <div className="flex gap-2">
        <label
          htmlFor="selfie-camera"
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium transition-colors cursor-pointer"
        >
          <Camera className="w-5 h-5 text-slate-500" />
          <span>Take Photo</span>
        </label>
        <label
          htmlFor="selfie-upload"
          className="flex items-center justify-center p-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 transition-colors cursor-pointer"
          title="Upload from device"
        >
          <ImageIcon className="w-5 h-5" />
        </label>
      </div>
      
      {/* Primary capture input specifically triggers front camera on mobile */}
      <input
        id="selfie-camera"
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/*"
        capture="user"
        className="hidden"
      />
      
      {/* Fallback upload input */}
      <input
        id="selfie-upload"
        type="file"
        onChange={handleFileUpload}
        accept="image/*"
        className="hidden"
      />
    </div>
  );
}
