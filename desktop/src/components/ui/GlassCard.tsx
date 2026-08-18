import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface GlassCardProps extends HTMLMotionProps<'div'> {
  children: ReactNode;
  strong?: boolean;
}

/**
 * Reusable glassmorphic surface. Every card / panel / modal in the app derives
 * from this — keeps the vocabulary of the design system in one place.
 */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  { children, className, strong = false, ...rest },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
      className={cn(strong ? 'glass-strong' : 'glass', 'p-6', className)}
      {...rest}
    >
      {children}
    </motion.div>
  );
});
