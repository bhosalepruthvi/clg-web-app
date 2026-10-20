import React from 'react';
import { useNavigate } from 'react-router-dom';

import { LogoMark, IconBook, IconPresentation, IconArrowRight } from './icons';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-indigo-50 flex flex-col justify-between text-indigo-900 selection:bg-indigo-200">
      {/* Top Navigation */}
      <header className="px-6 py-6 max-w-6xl mx-auto w-full flex items-center justify-between border-b border-indigo-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-600/25">
            <LogoMark className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-extrabold text-xl tracking-tight leading-none text-indigo-900">StudyFlow</h1>
            <p className="text-xs text-slate-500 font-medium">Academic Management System</p>
          </div>
        </div>
        <span className="text-xs font-semibold px-3 py-1 rounded-full bg-white border border-indigo-200 text-indigo-600">
          v2.0
        </span>
      </header>

      {/* Main Choice Section */}
      <main className="max-w-4xl mx-auto px-4 py-12 flex-1 flex flex-col items-center justify-center text-center">
        <div className="mb-10 max-w-2xl">
          <span className="px-3.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700 border border-indigo-200 tracking-wide uppercase">
            Two-Sided Academic Portal
          </span>
          <h2 className="text-4xl sm:text-5xl font-black mt-4 tracking-tight leading-tight text-indigo-900">
            Select Your Portal
          </h2>
          <p className="text-slate-500 text-sm sm:text-base mt-3">
            Sign in with your faculty credentials or use your division access code for instant coursework access.
          </p>
        </div>

        {/* Two Large Distinct Buttons/Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
          {/* Teacher Card */}
          <button
            onClick={() => navigate('/teacher-login')}
            className="group p-8 rounded-2xl bg-white hover:bg-indigo-50/40 border border-indigo-200/70 hover:border-indigo-400 transition-all duration-300 shadow-sm shadow-indigo-100 hover:shadow-xl hover:shadow-indigo-100 hover:-translate-y-1 text-left flex flex-col justify-between focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
          >
            <div>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-lg shadow-indigo-600/25">
                <IconPresentation className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-2xl font-extrabold text-indigo-900">I am a Teacher</h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                Create classes, manage lab sub-batches, upload study materials, and take classroom roll calls.
              </p>
            </div>
            <div className="mt-8 w-full py-3.5 bg-indigo-600 group-hover:bg-indigo-500 rounded-xl font-bold text-sm text-white transition-colors shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2">
              <span>Enter Teacher Portal</span>
              <IconArrowRight className="w-4 h-4" />
            </div>
          </button>

          {/* Student Card */}
          <button
            onClick={() => navigate('/student-login')}
            className="group p-8 rounded-2xl bg-white hover:bg-indigo-50/40 border border-indigo-200/70 hover:border-violet-400 transition-all duration-300 shadow-sm shadow-indigo-100 hover:shadow-xl hover:shadow-indigo-100 hover:-translate-y-1 text-left flex flex-col justify-between focus:outline-none focus:ring-4 focus:ring-violet-500/20"
          >
            <div>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-600 to-fuchsia-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-lg shadow-violet-600/25">
                <IconBook className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-2xl font-extrabold text-indigo-900">I am a Student</h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                One-click entry using your unique code (e.g., FE-E-E1-36). View semester notes and lab resources.
              </p>
            </div>
            <div className="mt-8 w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 group-hover:from-indigo-500 group-hover:to-violet-500 rounded-xl font-bold text-sm text-white transition-colors shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2">
              <span>Enter Student Portal</span>
              <IconArrowRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-xs text-slate-400">
        StudyFlow &bull; Department Academic Management System &bull; Final Year Project
      </footer>
    </div>
  );
}
