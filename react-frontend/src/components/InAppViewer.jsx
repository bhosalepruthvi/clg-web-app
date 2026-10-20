import React, { useState } from 'react';

import { IconDownload, IconFile, IconX } from './icons';

/**
 * InAppViewer.jsx
 * Renders PDF documents directly inside the browser window without triggering a download.
 * Features Zoom In, Zoom Out, Page controls, and a 'Download for Offline' button.
 */
export default function InAppViewer({ file, onClose }) {
  const [scale, setScale] = useState(1.0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  if (!file) return null;

  const fileUrl = file.file_url || file.FILE_URL || '';
  const title = file.title || file.TITLE || 'Study Material PDF';
  const unit = file.unit_number || file.UNIT_NUMBER || '';
  const subject = file.subject_name || file.SUBJECT_NAME || '';

  // Zoom handlers
  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.2, 2.5));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.2, 0.6));
  };

  const handleResetZoom = () => {
    setScale(1.0);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex flex-col font-sans animate-fadeIn">
      {/* Top Controls Toolbar */}
      <header className="bg-slate-900 border-b border-slate-700/80 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-white shadow-lg">
        {/* File Info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-red-600/20 text-red-400 border border-red-500/30 flex items-center justify-center">
            <IconFile className="w-5 h-5" />
          </div>
          <div className="truncate">
            <h2 className="text-sm sm:text-base font-extrabold truncate text-white leading-tight">
              {title}
            </h2>
            <p className="text-xs text-slate-400 truncate">
              {subject} {unit && `\u2022 ${unit}`}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          {/* Zoom Controls */}
          <div className="flex items-center bg-slate-800 rounded-xl p-1 border border-slate-700 text-xs font-semibold">
            <button
              onClick={handleZoomOut}
              title="Zoom Out"
              className="px-2.5 py-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              &minus;
            </button>
            <span
              onClick={handleResetZoom}
              title="Click to reset zoom"
              className="px-2 text-slate-200 font-mono text-[11px] cursor-pointer"
            >
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              title="Zoom In"
              className="px-2.5 py-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              &#43;
            </button>
          </div>

          {/* 'Download for Offline' Button */}
          <a
            href={fileUrl}
            download={title.endsWith('.pdf') ? title : `${title}.pdf`}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-900/30"
          >
            <IconDownload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Download for Offline</span>
            <span className="sm:hidden">Offline</span>
          </a>

          {/* Close Viewer */}
          <button
            onClick={onClose}
            className="p-1.5 sm:px-3 sm:py-1.5 bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-colors border border-slate-700 flex items-center gap-1.5"
            title="Close Viewer"
          >
            <IconX className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </header>

      {/* PDF Canvas Container */}
      <div className="flex-1 overflow-auto bg-slate-950 p-4 sm:p-8 flex items-start justify-center">
        <div
          className="bg-white rounded-xl shadow-2xl overflow-hidden transition-transform duration-200 origin-top border border-slate-700 max-w-4xl w-full"
          style={{
            transform: `scale(${scale})`,
            minHeight: '80vh',
          }}
        >
          {loading && (
            <div className="p-8 text-center text-slate-500 text-xs">
              Loading in-app PDF document...
            </div>
          )}

          {/* Embedded in-browser PDF Viewer */}
          <iframe
            src={`${fileUrl}#toolbar=0&navpanes=0`}
            title={title}
            onLoad={() => setLoading(false)}
            className="w-full h-[85vh] border-0 rounded-xl bg-white"
          />
        </div>
      </div>
    </div>
  );
}
