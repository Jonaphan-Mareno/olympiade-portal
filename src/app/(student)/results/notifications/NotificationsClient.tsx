'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  date: Date;
  linkUrl: string | null;
  sender: 'Organizer' | 'Educator' | 'System';
  isDynamic: boolean;
}

export default function NotificationsClient({
  initialNotifications,
}: {
  initialNotifications: NotificationItem[];
}) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let readDynamicIds: string[] = [];
    try {
      readDynamicIds = JSON.parse(localStorage.getItem('read_dynamic_notifications') || '[]');
    } catch {}

    const loaded = initialNotifications.map(n => {
      if (n.isDynamic && readDynamicIds.includes(n.id)) {
        return { ...n, isRead: true };
      }
      return n;
    });

    setNotifications(loaded);
    setIsHydrated(true);
  }, [initialNotifications]);

  const markAsRead = async (id: string, isDynamic: boolean) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    
    if (isDynamic) {
      try {
        const readIds = JSON.parse(localStorage.getItem('read_dynamic_notifications') || '[]');
        if (!readIds.includes(id)) {
          readIds.push(id);
          localStorage.setItem('read_dynamic_notifications', JSON.stringify(readIds));
        }
      } catch {}
    } else {
      // If we had an API endpoint for persistent notifications, we would call it here:
      // await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
    }
  };

  const markAllAsRead = () => {
    const dynamicIds = notifications.filter(n => n.isDynamic).map(n => n.id);
    localStorage.setItem('read_dynamic_notifications', JSON.stringify(dynamicIds));
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  if (!isHydrated) return <div className="animate-pulse space-y-4">
      <div className="h-24 bg-slate-200 rounded-xl"></div>
      <div className="h-24 bg-slate-200 rounded-xl"></div>
  </div>;

  if (notifications.length === 0) {
    return (
      <div className="bg-white border-2 border-slate-200 rounded-xl p-16 text-center shadow-sm">
        <div className="inline-flex items-center justify-center w-24 h-24 bg-slate-50 border-2 border-slate-200 rounded-full mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">You're all caught up!</h3>
        <p className="text-slate-500 font-medium">There are no new notifications at this time.</p>
      </div>
    );
  }

  const getIcon = (sender: string) => {
      switch(sender) {
          case 'Organizer':
              return (
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center border border-blue-200 shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                  </div>
              );
          case 'Educator':
              return (
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center border border-amber-200 shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                  </div>
              );
          default:
              return (
                  <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center border border-slate-300 shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                  </div>
              );
      }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div>
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-slate-800">
                Inbox {unreadCount > 0 && <span className="ml-2 bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">{unreadCount} new</span>}
            </h2>
            {unreadCount > 0 && (
                <button onClick={markAllAsRead} className="text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors">
                    Mark all as read
                </button>
            )}
        </div>

        <div className="space-y-4">
            {notifications.map(n => (
                <div 
                    key={n.id} 
                    className={`flex flex-col md:flex-row gap-4 p-5 md:p-6 rounded-xl border bg-white transition-colors relative overflow-hidden ${
                        n.isRead 
                            ? 'border-slate-200' 
                            : 'border-slate-300 shadow-md ring-1 ring-slate-100'
                    }`}
                >
                    {!n.isRead && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-blue-500" />}
                    <div className="flex items-start gap-4 flex-1">
                        {getIcon(n.sender)}
                        <div className="flex-1 w-full">
                            <div className="flex justify-between items-start mb-1 gap-2 w-full">
                                <span className={`text-xs font-bold uppercase tracking-wider ${n.sender === 'Organizer' ? 'text-blue-700' : n.sender === 'Educator' ? 'text-amber-700' : 'text-slate-500'}`}>
                                    {n.sender}
                                </span>
                                <span className="text-xs font-medium text-slate-400 whitespace-nowrap pt-0.5">
                                    {new Date(n.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at {new Date(n.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                            <h4 className={`text-lg mb-1 ${n.isRead ? 'font-semibold text-slate-800' : 'font-bold text-slate-900'}`}>
                                {n.title}
                            </h4>
                            <p className="text-slate-600 font-medium leading-relaxed">
                                {n.message}
                            </p>
                        </div>
                    </div>
                    {!n.isRead && (
                        <div className="flex items-center justify-end shrink-0 mt-4 md:mt-0">
                            <button 
                                onClick={() => markAsRead(n.id, n.isDynamic)}
                                className="text-sm font-bold text-blue-600 hover:text-blue-800 transition-colors px-4 py-2 border border-blue-200 hover:border-blue-300 rounded-lg bg-blue-50 hover:bg-blue-100"
                            >
                                Mark Read
                            </button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    </div>
  );
}
