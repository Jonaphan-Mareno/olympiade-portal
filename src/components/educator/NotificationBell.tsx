'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { getUnreadNotifications, markAsRead, markAllAsRead } from '@/app/educator/notifications/actions';

type Notification = {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  linkUrl: string | null;
  createdAt: Date;
};

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000); // Poll every minute
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function fetchNotifications() {
    const unread = await getUnreadNotifications();
    setNotifications(unread);
  }

  async function handleNotificationClick(id: string) {
    await markAsRead(id);
    setNotifications(prev => prev.filter(n => n.id !== id));
  }

  async function handleMarkAllRead() {
    await markAllAsRead();
    setNotifications([]);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
        aria-label="Notifications"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        {notifications.length > 0 && (
          <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden">
          <div className="p-3 border-b border-slate-200 flex justify-between items-center bg-slate-50">
            <h3 className="font-semibold text-slate-800">Notifications</h3>
            {notifications.length > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500">
                You have no unread notifications.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {notifications.map(n => (
                  <li key={n.id} className="p-3 hover:bg-slate-50 transition-colors">
                    {n.linkUrl ? (
                      <Link 
                        href={n.linkUrl} 
                        onClick={() => handleNotificationClick(n.id)}
                        className="block"
                      >
                        <div className="font-medium text-sm text-slate-900 mb-1">{n.title}</div>
                        <div className="text-xs text-slate-600">{n.message}</div>
                      </Link>
                    ) : (
                      <div onClick={() => handleNotificationClick(n.id)} className="cursor-pointer">
                        <div className="font-medium text-sm text-slate-900 mb-1">{n.title}</div>
                        <div className="text-xs text-slate-600">{n.message}</div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="p-2 border-t border-slate-200 bg-slate-50 text-center">
            <Link 
              href="/educator/notifications" 
              onClick={() => setIsOpen(false)}
              className="text-xs font-medium text-slate-600 hover:text-blue-600"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
