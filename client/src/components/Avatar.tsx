interface AvatarProps {
  src?: string;
  alt?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function Avatar({ src, alt = 'Avatar', size = 'md', className = '' }: AvatarProps) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
  };

  // Local neutral fallback (simple user silhouette) to avoid external image CSP issues.
  // Falls back to this on error or when no src provided.
  const localFallback =
    'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27%236b7280%27%3E%3Cpath d=%27M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z%27/%3E%3C/svg%3E';

  const effectiveSrc = src || localFallback;

  return (
    <img
      src={effectiveSrc}
      alt={alt}
      className={`${sizeClasses[size]} rounded-full object-cover border border-slate-200 ${className}`}
      onError={(e) => {
        (e.target as HTMLImageElement).src = localFallback;
      }}
    />
  );
}
