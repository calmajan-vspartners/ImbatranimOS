import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@imbatranim/ui'

type UploadDropzoneProps = {
  onFiles: (files: File[]) => void
  children: React.ReactNode
  className?: string
}

export function UploadDropzone({ onFiles, children, className }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCountRef = useRef(0)

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    dragCountRef.current++
    setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragCountRef.current--
    if (dragCountRef.current === 0) setIsDragging(false)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    dragCountRef.current = 0
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) onFiles(files)
  }

  return (
    <div
      className={cn('relative', className)}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {isDragging && (
        <div className="border-primary bg-surface-container-lowest/90 absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 border-2 border-dashed">
          <Upload size={32} strokeWidth={1.5} className="text-primary" />
          <span className="font-ui text-primary text-[13px] font-semibold">
            Drop files to upload
          </span>
        </div>
      )}
    </div>
  )
}
