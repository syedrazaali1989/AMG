'use client';

import { useEffect, useState } from 'react';

interface CountdownProps {
    targetTime: Date;
}

export function Countdown({ targetTime }: CountdownProps) {
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
        const updateCountdown = () => {
            const now = new Date().getTime();
            const target = new Date(targetTime).getTime();
            const difference = target - now;

            if (difference <= 0) {
                setTimeLeft('Closing now');
                return;
            }

            const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((difference % (1000 * 60)) / 1000);

            if (hours > 0) {
                setTimeLeft(`${hours}h ${minutes}m`);
            } else if (minutes > 0) {
                setTimeLeft(`${minutes}m ${seconds}s`);
            } else {
                setTimeLeft(`${seconds}s`);
            }
        };

        updateCountdown();
        const interval = setInterval(updateCountdown, 1000);

        return () => clearInterval(interval);
    }, [targetTime]);

    return (
        <span className="text-xs font-medium text-primary">
            {timeLeft}
        </span>
    );
}
