import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type RecordingSource = 'upload' | 'phone';

@Entity('recordings')
export class Recording {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  /** RECORDINGS_DIR 기준 상대 경로 (예: upload/abc.wav, phone/20001-....wav) */
  @Column()
  filename: string;

  @Column({ type: 'real', default: 0 })
  durationSec: number;

  @Column({ type: 'varchar' })
  source: RecordingSource;

  @Column({ type: 'int', nullable: true })
  createdById: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
