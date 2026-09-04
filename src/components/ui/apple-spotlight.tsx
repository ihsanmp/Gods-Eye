'use client';

import { cn } from '@/lib/utils';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Calendar,
  ChevronRight,
  Files,
  Folder,
  Globe,
  Image,
  LayoutGrid,
  Mail,
  MessageSquare,
  Music,
  Search,
  Settings,
  StickyNote,
  Terminal,
  Bird
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

interface Shortcut {
  label: string;
  icon: React.ReactNode;
  /** Where the demo's buttons go. Optional now that a shortcut can search. */
  link?: string;
  /**
   * Search this instead of opening a link.
   *
   * A shortcut with a query types it into the field rather than doing anything
   * of its own, so it goes down the exact path a typed search does - the same
   * debounce, the same results list, the same Enter and the same reset. The
   * field filling in is also the honest signal that a search is running, and
   * it is what makes the results appear at all, since the list is shown only
   * when the field has something in it.
   */
  query?: string;
}

interface SearchResult {
  icon: React.ReactNode;
  label: string;
  description: string;
  link: string;
}

const SVGFilter = () => {
  return (
    <svg width="0" height="0">
      <filter id="blob">
        <feGaussianBlur stdDeviation="10" in="SourceGraphic" />
        <feColorMatrix
          values="
      1 0 0 0 0
      0 1 0 0 0
      0 0 1 0 0
      0 0 0 18 -9
    "
          result="blob"
        />
        <feBlend in="SourceGraphic" in2="blob" />
      </filter>
    </svg>
  );
};

interface ShortcutButtonProps {
  icon: React.ReactNode;
  link?: string;
  label?: string;
  onClick?: () => void;
}

const ShortcutButton = ({ icon, link, label, onClick }: ShortcutButtonProps) => {
  const body = (
    <div className="rounded-full cursor-pointer hover:shadow-lg opacity-30 hover:opacity-100 transition-[opacity,shadow] duration-200">
      <div className="size-16 aspect-square flex items-center justify-center">{icon}</div>
    </div>
  );

  // A searching shortcut is a button, not a link: it stays on the page, and a
  // screen reader should not be told it navigates somewhere.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={label} aria-label={label}>
        {body}
      </button>
    );
  }

  return (
    <a href={link} target="_blank" title={label} aria-label={label}>
      {body}
    </a>
  );
};

interface SpotlightPlaceholderProps {
  text: string;
  className?: string;
}

const SpotlightPlaceholder = ({ text, className }: SpotlightPlaceholderProps) => {
  return (
    <motion.div
      layout
      className={cn('absolute text-gray-500 flex items-center pointer-events-none z-10', className)}
    >
      <AnimatePresence mode="popLayout">
        <motion.p
          layoutId={`placeholder-${text}`}
          key={`placeholder-${text}`}
          initial={{ opacity: 0, y: 10, filter: 'blur(5px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(5px)' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {text}
        </motion.p>
      </AnimatePresence>
    </motion.div>
  );
};

interface SpotlightInputProps {
  placeholder: string;
  hidePlaceholder: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholderClassName?: string;
}

const SpotlightInput = ({
  placeholder,
  hidePlaceholder,
  value,
  onChange,
  onSubmit,
  placeholderClassName
}: SpotlightInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus the input when the component mounts
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex items-center w-full justify-start gap-2 px-6 h-16">
      <motion.div layoutId="search-icon">
        <Search />
      </motion.div>
      <div className="flex-1 relative text-2xl">
        {!hidePlaceholder && (
          <SpotlightPlaceholder text={placeholder} className={placeholderClassName} />
        )}

        <motion.input
          ref={inputRef}
          layout="position"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            onSubmit?.();
          }}
          className="w-full bg-transparent outline-none ring-none"
        />
      </div>
    </div>
  );
};

interface SearchResultCardProps extends SearchResult {
  isLast: boolean;
  onSelect?: () => void;
}

const SearchResultCard = ({ icon, label, description, link, isLast, onSelect }: SearchResultCardProps) => {
  return (
    <a
      href={link}
      target={onSelect ? undefined : '_blank'}
      onClick={
        onSelect
          ? (event) => {
            // A live result is an action in this app, not a link out.
            event.preventDefault();
            onSelect();
          }
          : undefined
      }
      className="overflow-hidden w-full group/card"
    >
      <div
        className={cn(
          'flex items-center text-black justify-start hover:bg-white gap-3 py-2 px-2 rounded-xl hover:shadow-md w-full',
          isLast && 'rounded-b-3xl'
        )}
      >
        <div className="size-8 [&_svg]:stroke-[1.5] [&_svg]:size-6 aspect-square flex items-center justify-center">
          {icon}
        </div>
        <div className="flex flex-col">
          <p className="font-medium">{label}</p>
          <p className="text-xs opacity-50">{description}</p>
        </div>
        <div className="flex-1 flex items-center justify-end opacity-0 group-hover/card:opacity-100 transition-opacity duration-200">
          <ChevronRight className="size-6" />
        </div>
      </div>
    </a>
  );
};

interface SearchResultsContainerProps {
  searchResults: SearchResult[];
  onHover: (index: number | null) => void;
  onSelect?: (result: SearchResult, index: number) => void;
}

const SearchResultsContainer = ({ searchResults, onHover, onSelect }: SearchResultsContainerProps) => {
  return (
    <motion.div
      layout
      onMouseLeave={() => onHover(null)}
      className="px-2 border-t flex flex-col bg-neutral-100 max-h-96 overflow-y-auto w-full py-2"
    >
      {searchResults.map((result, index) => {
        return (
          <motion.div
            key={`search-result-${index}`}
            onMouseEnter={() => onHover(index)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              delay: index * 0.1,
              duration: 0.2,
              ease: 'easeOut'
            }}
          >
            <SearchResultCard
              icon={result.icon}
              label={result.label}
              description={result.description}
              link={result.link}
              isLast={index === searchResults.length - 1}
              onSelect={onSelect ? () => onSelect(result, index) : undefined}
            />
          </motion.div>
        );
      })}
    </motion.div>
  );
};

interface AppleSpotlightProps {
  shortcuts?: Shortcut[];
  isOpen?: boolean;
  handleClose?: () => void;
  /**
   * Live results. When omitted the component keeps its own sample list, so the
   * demo still works standalone; when supplied it stops being a demo and shows
   * whatever the host searched.
   */
  results?: SearchResult[];
  /** Every keystroke, so the host can run the search. */
  onSearchChange?: (value: string) => void;
  /** A row was chosen. Present only for live results. */
  onSelectResult?: (result: SearchResult, index: number) => void;
  /**
   * Enter was pressed. The bar clears itself afterwards, so a completed search
   * leaves the same empty field it started from rather than a stale list
   * describing somewhere the camera has already flown.
   */
  onSubmit?: () => void;
  /** Shown in place of the list while a search is in flight or found nothing. */
  emptyMessage?: string | null;
  /**
   * Content attached under the field, inside the same pill.
   *
   * The bar is the one search surface in this app, so directions belong in it
   * rather than in a panel somewhere else. While a panel is mounted it takes
   * the place of the results list - the operator has stopped choosing a place
   * and started planning a journey, and showing both at once would offer two
   * different next steps for the same Enter key.
   */
  panel?: React.ReactNode;
}

const AppleSpotlight = ({
  shortcuts = [
    {
      label: 'Apps',
      icon: <LayoutGrid />,
      link: '/docs/components'
    },
    {
      label: 'Files',
      icon: <Folder />,
      link: '/docs/texts'
    },
    {
      label: 'Actions',
      icon: <Activity />,
      link: '/docs/buttons'
    },
    {
      label: 'Clipboard',
      icon: <Files />,
      link: '/docs/backgrounds'
    }
  ],
  isOpen = true,
  handleClose = () => {},
  results,
  onSearchChange,
  onSelectResult,
  onSubmit,
  emptyMessage = null,
  panel = null
}: AppleSpotlightProps) => {
  const [hovered, setHovered] = useState(false);
  const [hoveredSearchResult, setHoveredSearchResult] = useState<number | null>(null);
  const [hoveredShortcut, setHoveredShortcut] = useState<number | null>(null);
  const [searchValue, setSearchValue] = useState('');

  const handleSearchValueChange = (value: string) => {
    setSearchValue(value);
    onSearchChange?.(value);
  };

  /**
   * Reset to the resting state. Used after Enter and after a row is chosen:
   * both finish the search, and leaving the list up would keep describing a
   * place the camera has already gone to.
   */
  const resetSearch = () => {
    setSearchValue('');
    setHoveredSearchResult(null);
    onSearchChange?.('');
  };

  const handleSubmit = () => {
    onSubmit?.();
    resetSearch();
  };

  const handleSelect = (result: SearchResult, index: number) => {
    onSelectResult?.(result, index);
    resetSearch();
  };

  const sampleResults: SearchResult[] = [
    {
      icon: <Bird />, // lucide-react v1 dropped its brand icons; Twitter no longer exists
      label: 'Twitter',
      description: 'Follow me on Twitter',
      link: 'https://x.com/samitkapoorr'
    },
    {
      icon: <Globe />,
      label: 'Safari',
      description: 'Open Safari web browser',
      link: 'https://x.com/samitkapoorr'
    },
    {
      icon: <Mail />,
      label: 'Mail',
      description: 'Open Mail application',
      link: 'https://x.com/samitkapoorr'
    },
    {
      icon: <Calendar />,
      label: 'Calendar',
      description: 'View your calendar events',
      link: 'https://x.com/samitkapoorr'
    },
    {
      icon: <StickyNote />,
      label: 'Notes',
      description: 'Open Notes application',
      link: 'https://x.com/samitkapoorr'
    },
    {
      icon: <Image />,
      label: 'Photos',
      description: 'Browse your photo library',
      link: 'https://x.com/samitkapoorr'
    },
    {
      icon: <Settings />,
      label: 'System Settings',
      description: 'Open System Preferences',
      link: 'https://x.com/samitkapoorr'
    },
    {
      icon: <Terminal />,
      label: 'Terminal',
      description: 'Open Terminal application',
      link: 'https://x.com/samitkapoorr'
    },
    {
      icon: <Folder />,
      label: 'Finder',
      description: 'Open Finder file manager',
      link: 'https://x.com/samitkapoorr'
    },
    {
      icon: <MessageSquare />,
      label: 'Messages',
      description: 'Open Messages application',
      link: 'https://x.com/samitkapoorr'
    },
    {
      icon: <Music />,
      label: 'Music',
      description: 'Open Music application',
      link: 'https://x.com/samitkapoorr'
    }
  ];

  // Live results replace the sample list entirely once the host supplies them.
  const searchResults = results ?? sampleResults;

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          initial={{
            opacity: 0,
            filter: 'blur(20px) url(#blob)',
            scaleX: 1.3,
            scaleY: 1.1,
            y: -10
          }}
          animate={{
            opacity: 1,
            filter: 'blur(0px) url(#blob)',
            scaleX: 1,
            scaleY: 1,
            y: 0
          }}
          exit={{
            opacity: 0,
            filter: 'blur(20px) url(#blob)',
            scaleX: 1.3,
            scaleY: 1.1,
            y: 10
          }}
          transition={{
            stiffness: 550,
            damping: 50,
            type: 'spring'
          }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          onClick={handleClose}
        >
          <SVGFilter />

          <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => {
              setHovered(false);
              setHoveredShortcut(null);
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ filter: 'url(#blob)' }}
            className={cn(
              'w-full flex items-center justify-end gap-4 z-20 group',
              '[&>div]:bg-neutral-100 [&>div]:text-black [&>div]:rounded-full [&>div]:backdrop-blur-xl',
              '[&_svg]:size-7 [&_svg]:stroke-[1.4]',
              'max-w-3xl'
            )}
          >
            <AnimatePresence mode="popLayout">
              <motion.div
                layoutId="search-input-container"
                transition={{
                  layout: {
                    duration: 0.5,
                    type: 'spring',
                    bounce: 0.2
                  }
                }}
                style={{
                  borderRadius: '30px'
                }}
                className="h-full w-full flex flex-col items-center justify-start z-10 relative shadow-lg overflow-hidden border"
              >
                <SpotlightInput
                  placeholder={
                    hoveredShortcut !== null
                      ? shortcuts[hoveredShortcut].label
                      : hoveredSearchResult !== null
                      ? searchResults[hoveredSearchResult].label
                      : 'Search'
                  }
                  placeholderClassName={
                    hoveredSearchResult !== null ? 'text-black bg-white' : 'text-gray-500'
                  }
                  hidePlaceholder={!(hoveredSearchResult !== null || !searchValue)}
                  value={searchValue}
                  onChange={handleSearchValueChange}
                  onSubmit={handleSubmit}
                />

                {panel}

                {!panel && searchValue && searchResults.length > 0 && (
                  <SearchResultsContainer
                    searchResults={searchResults}
                    onHover={setHoveredSearchResult}
                    onSelect={onSelectResult ? handleSelect : undefined}
                  />
                )}
                {!panel && searchValue && searchResults.length === 0 && emptyMessage && (
                  <div className="px-6 py-4 w-full border-t bg-neutral-100 text-sm text-gray-500">
                    {emptyMessage}
                  </div>
                )}
              </motion.div>
              {hovered &&
                !searchValue &&
                shortcuts.map((shortcut, index) => (
                  <motion.div
                    key={`shortcut-${index}`}
                    onMouseEnter={() => setHoveredShortcut(index)}
                    layout
                    initial={{ scale: 0.7, x: -1 * (64 * (index + 1)) }}
                    animate={{ scale: 1, x: 0 }}
                    exit={{
                      scale: 0.7,
                      x:
                        1 *
                        (16 * (shortcuts.length - index - 1) + 64 * (shortcuts.length - index - 1))
                    }}
                    transition={{
                      duration: 0.8,
                      type: 'spring',
                      bounce: 0.2,
                      delay: index * 0.05
                    }}
                    className="rounded-full cursor-pointer"
                  >
                    <ShortcutButton
                      icon={shortcut.icon}
                      link={shortcut.link}
                      label={shortcut.label}
                      onClick={
                        shortcut.query
                          ? () => handleSearchValueChange(shortcut.query as string)
                          : undefined
                      }
                    />
                  </motion.div>
                ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export { AppleSpotlight };
