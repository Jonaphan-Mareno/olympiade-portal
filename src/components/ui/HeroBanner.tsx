import React from 'react';

interface HeroBannerProps {
  userName?: string;
  userInitial?: string;
}

export default function HeroBanner({ userName = 'there', userInitial = '?' }: HeroBannerProps) {
  return (
    <div className="relative w-full h-[33vh] min-h-[320px] overflow-hidden bg-[url('/images/banner.jpg')] bg-cover bg-center bg-no-repeat">
      {/* Foreground Content Layer */}
      <div className="absolute inset-0 z-10 flex items-center p-8 pb-16 md:p-12 md:pb-24">
        <div className="flex items-center gap-6">
          {/* Avatar Container with Organic 'Blob' Border Radius */}
          <div 
            className="flex items-center justify-center w-20 h-20 md:w-24 md:h-24 bg-white shadow-xl flex-shrink-0"
            style={{ borderRadius: '60% 40% 30% 70% / 60% 30% 70% 40%' }}
          >
            <span className="text-3xl md:text-4xl font-bold text-[#1E3A8A]">{userInitial}</span>
          </div>

          {/* Text Content */}
          <div className="flex flex-col">
            <h1 className="font-serif text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-tight drop-shadow-sm mb-2">
              Welcome back, {userName}
            </h1>
            <p className="text-blue-50 text-sm md:text-base font-medium opacity-90 drop-shadow-sm">
              Here is what's happening with your Olympiads today.
            </p>
          </div>
        </div>
      </div>

      {/* Bottom White Wave Divider */}
      <svg
        className="absolute bottom-0 left-0 w-full translate-y-[1px] z-20"
        viewBox="0 0 1440 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        style={{ height: '80px' }}
      >
        <path
          d="M0,50 C240,100 480,0 720,50 C960,100 1200,0 1440,50 L1440,100 L0,100 Z"
          fill="#F8FAFC"
        />
      </svg>
    </div>
  );
}
