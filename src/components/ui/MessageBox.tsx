'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type MessageType = 'success' | 'error' | 'info' | 'warning';

export interface Message {
    id: string;
    type: MessageType;
    title: string;
    description?: string;
    duration?: number;
}

interface MessageBoxProps {
    messages: Message[];
    onDismiss: (id: string) => void;
}

const messageIcons = {
    success: CheckCircle,
    error: AlertCircle,
    info: Info,
    warning: AlertTriangle
};

const messageColors = {
    success: 'border-success/50 bg-success/10 text-success',
    error: 'border-danger/50 bg-danger/10 text-danger',
    info: 'border-primary/50 bg-primary/10 text-primary',
    warning: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-500'
};

export function MessageBox({ messages, onDismiss }: MessageBoxProps) {
    return (
        <div className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
            <AnimatePresence>
                {messages.map((message) => (
                    <MessageItem
                        key={message.id}
                        message={message}
                        onDismiss={onDismiss}
                    />
                ))}
            </AnimatePresence>
        </div>
    );
}

function MessageItem({ message, onDismiss }: { message: Message; onDismiss: (id: string) => void }) {
    const [isHovered, setIsHovered] = useState(false);
    const Icon = messageIcons[message.type];

    useEffect(() => {
        if (message.duration && !isHovered) {
            const timer = setTimeout(() => {
                onDismiss(message.id);
            }, message.duration);

            return () => clearTimeout(timer);
        }
    }, [message.id, message.duration, isHovered, onDismiss]);

    return (
        <motion.div
            initial={{ opacity: 0, x: 100, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.8 }}
            transition={{ duration: 0.3 }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={cn(
                'glass border-2 rounded-lg p-4 shadow-lg',
                messageColors[message.type]
            )}
        >
            <div className="flex items-start gap-3">
                <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm mb-1">{message.title}</h4>
                    {message.description && (
                        <p className="text-xs opacity-90">{message.description}</p>
                    )}
                </div>
                <button
                    onClick={() => onDismiss(message.id)}
                    className="flex-shrink-0 hover:opacity-70 transition-opacity"
                    aria-label="Dismiss message"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </motion.div>
    );
}

// Hook for managing messages
export function useMessages() {
    const [messages, setMessages] = useState<Message[]>([]);

    const addMessage = (message: Omit<Message, 'id'>) => {
        const id = `${Date.now()}-${Math.random()}`;
        setMessages((prev) => [...prev, { ...message, id }]);
    };

    const dismissMessage = (id: string) => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
    };

    const showSuccess = (title: string, description?: string, duration = 5000) => {
        addMessage({ type: 'success', title, description, duration });
    };

    const showError = (title: string, description?: string, duration = 7000) => {
        addMessage({ type: 'error', title, description, duration });
    };

    const showInfo = (title: string, description?: string, duration = 5000) => {
        addMessage({ type: 'info', title, description, duration });
    };

    const showWarning = (title: string, description?: string, duration = 6000) => {
        addMessage({ type: 'warning', title, description, duration });
    };

    return {
        messages,
        addMessage,
        dismissMessage,
        showSuccess,
        showError,
        showInfo,
        showWarning
    };
}
