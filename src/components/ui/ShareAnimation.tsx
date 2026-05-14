import React, { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';

interface ASCIIAnimationProps {
    onComplete?: () => void;
    onClose?: () => void;
    theme: string;
}

const SHARE_ASCII = [
    "  _____ _    _         _____  ______ ",
    " / ____| |  | |  /\\   |  __ \\|  ____|",
    "| (___ | |__| | /  \\  | |__) | |__   ",
    " \\___ \\|  __  |/ /\\ \\ |  _  /|  __|  ",
    " ____) | |  | / ____ \\| | \\ \\| |____ ",
    "|_____/|_|  |_/_/    \\_\\_|  \\_\\______|",
    "                                     ",
    "         + SHARE FOUND +             "
];

export const ShareAnimation: React.FC<ASCIIAnimationProps> = ({ onComplete, onClose, theme }) => {
    const [visibleLines, setVisibleLines] = useState<number>(0);
    const [opacity, setOpacity] = useState(1);

    useEffect(() => {
        // Line by line revealing animation
        const revealInterval = setInterval(() => {
            setVisibleLines(prev => {
                if (prev >= SHARE_ASCII.length) {
                    clearInterval(revealInterval);
                    return prev;
                }
                return prev + 1;
            });
        }, 50);

        // Start fading out after 2 seconds
        const fadeOutTimeout = setTimeout(() => {
            setOpacity(0);
        }, 2000);

        // Complete the component after fade out
        const completeTimeout = setTimeout(() => {
            if (onComplete) onComplete();
        }, 2500);

        return () => {
            clearInterval(revealInterval);
            clearTimeout(fadeOutTimeout);
            clearTimeout(completeTimeout);
        };
    }, [onComplete]);

    return (
        <div 
            className={cn(
                "fixed inset-0 z-50 flex items-center justify-center pointer-events-none transition-opacity duration-500",
                opacity === 0 ? "opacity-0" : "opacity-100"
            )}
        >
            <div className={cn(
                "relative p-8 rounded-2xl border backdrop-blur-md shadow-2xl scale-110 pointer-events-auto",
                theme === 'light' 
                    ? "bg-white/80 border-emerald-200 text-emerald-600 shadow-emerald-100" 
                    : "bg-zinc-950/80 border-emerald-500/30 text-emerald-400 shadow-emerald-950/50"
            )}>
                <button
                    type="button"
                    onClick={onClose}
                    className={cn(
                        "absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-lg leading-none transition-colors",
                        theme === 'light'
                            ? "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900"
                            : "text-zinc-500 hover:bg-white/10 hover:text-white"
                    )}
                    aria-label="Close share notification"
                    title="Close"
                >
                    x
                </button>
                <pre className="font-mono text-[10px] sm:text-xs leading-tight">
                    {SHARE_ASCII.map((line, i) => (
                        <div 
                            key={i} 
                            className={cn(
                                "transition-all duration-300",
                                i < visibleLines ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
                            )}
                        >
                            {line}
                        </div>
                    ))}
                </pre>
                
                {/* Decorative sparks */}
                <div className="absolute -top-4 -left-4 w-8 h-8 border-t-2 border-l-2 border-emerald-500 rounded-tl-lg animate-pulse" />
                <div className="absolute -bottom-4 -right-4 w-8 h-8 border-b-2 border-r-2 border-emerald-500 rounded-br-lg animate-pulse" />
            </div>
        </div>
    );
};
