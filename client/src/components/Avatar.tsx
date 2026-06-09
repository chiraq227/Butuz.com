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

  const fallback = `https://api.dicebear.com/7.x/avataaars/svg?seed=${alt}`;

  return (
    <img
      src={src || fallback}
      alt={alt}
      className={`${sizeClasses[size]} rounded-full object-cover border border-slate-200 ${className}`}
      onError={(e) => {
        (e.target as HTMLImageElement).src = fallback;
      }}
    />
  );
}
