import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a5f] via-[#162740] to-indigo-950 flex flex-col justify-between text-white selection:bg-blue-500">
      {/* Top Navigation */}
      <header className="px-6 py-6 max-w-6xl mx-auto w-full flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-lg shadow-lg shadow-blue-500/30">
            SF
          </div>
          <div>
            <h1 className="font-extrabold text-xl tracking-tight leading-none">StudyFlow</h1>
            <p className="text-xs text-blue-200/70 font-medium">Academic Management System</p>
          </div>
        </div>
        <span className="text-xs font-semibold px-3 py-1 rounded-full bg-white/10 border border-white/15 text-blue-200">
          v2.0
        </span>
      </header>

      {/* Main Choice Section */}
      <main className="max-w-4xl mx-auto px-4 py-12 flex-1 flex flex-col items-center justify-center text-center">
        <div className="mb-10 max-w-2xl">
          <span className="px-3.5 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 tracking-wide uppercase">
            Two-Sided Academic Portal
          </span>
          <h2 className="text-4xl sm:text-5xl font-black mt-4 tracking-tight leading-tight">
            Select Your Portal
          </h2>
          <p className="text-slate-300 text-sm sm:text-base mt-3">
            Sign in with your faculty credentials or use your division access code for instant coursework access.
          </p>
        </div>

        {/* Two Large Distinct Buttons/Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
          {/* Teacher Card */}
          <button
            onClick={() => navigate('/teacher-login')}
            className="group p-8 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/15 hover:border-blue-400 transition-all duration-300 shadow-2xl hover:-translate-y-1 text-left flex flex-col justify-between focus:outline-none focus:ring-4 focus:ring-blue-500/20"
          >
            <div>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#1e3a5f] to-blue-600 flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform shadow-lg shadow-blue-500/30">
                👨‍🏫
              </div>
              <h3 className="text-2xl font-extrabold text-white">I am a Teacher</h3>
              <p className="text-sm text-slate-300 mt-2 leading-relaxed">
                Create classes, manage lab sub-batches, upload study materials, and take classroom roll calls.
              </p>
            </div>
            <div className="mt-8 w-full py-3.5 bg-blue-600 group-hover:bg-blue-500 rounded-xl font-bold text-sm text-white transition-colors shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2">
              <span>Enter Teacher Portal</span>
              <span>&rarr;</span>
            </div>
          </button>

          {/* Student Card */}
          <button
            onClick={() => navigate('/student-login')}
            className="group p-8 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/15 hover:border-indigo-400 transition-all duration-300 shadow-2xl hover:-translate-y-1 text-left flex flex-col justify-between focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
          >
            <div>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform shadow-lg shadow-indigo-500/30">
                🎓
              </div>
              <h3 className="text-2xl font-extrabold text-white">I am a Student</h3>
              <p className="text-sm text-slate-300 mt-2 leading-relaxed">
                One-click entry using your unique code (e.g., FE-E-E1-36). View semester notes and lab resources.
              </p>
            </div>
            <div className="mt-8 w-full py-3.5 bg-indigo-600 group-hover:bg-indigo-500 rounded-xl font-bold text-sm text-white transition-colors shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2">
              <span>Enter Student Portal</span>
              <span>&rarr;</span>
            </div>
          </button>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-6 text-xs text-blue-200/50">
        StudyFlow &bull; Department Academic Management System &bull; Final Year Project
      </footer>
    </div>
  );
}
