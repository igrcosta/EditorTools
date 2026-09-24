import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CAPTION_POSITION_DEFAULT,
  CAPTION_POSITION_Y_DEFAULT,
  CAPTION_SCALE_DEFAULT,
  type CaptionPreset,
  type CaptionWord,
  type CustomCaptionStyle,
} from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DesktopOnlyNotice } from '../../components/DesktopOnlyNotice';
import { Dropzone } from '../../components/Dropzone';
import { ErrorMessage } from '../../components/ErrorMessage';
import { JobStatus } from '../../components/JobStatus';
import { PageHeader } from '../../components/PageHeader';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { useFeatures } from '../../lib/useFeatures';
import { useJobRunner } from '../../lib/useJobRunner';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { CaptionFrame } from './CaptionFrame';
import { CustomTemplateEditor } from './CustomTemplateEditor';
import { deleteCustomTemplate, loadCustomTemplates, saveCustomTemplate, type CustomTemplate } from './customTemplates';
import { TemplateGallery } from './TemplateGallery';

const ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska';
const DEFAULT_KEY: CaptionPreset = 'clean';

interface TranscribeResult {
  words: CaptionWord[];
}

export function CaptionsPage() {
  const { t } = useTranslation('captions');
  const features = useFeatures();
  const transcribeRunner = useJobRunner({ autoSave: false });
  const renderRunner = useJobRunner({ autoSave: false });

  const [file, setFile] = useState<File | null>(null);
  const [words, setWords] = useState<CaptionWord[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>(DEFAULT_KEY);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [positionX, setPositionX] = useState(CAPTION_POSITION_DEFAULT);
  const [positionY, setPositionY] = useState(CAPTION_POSITION_Y_DEFAULT);
  const [scale, setScale] = useState(CAPTION_SCALE_DEFAULT);
  const localUrl = useObjectUrl(file);

  useEffect(() => {
    setCustomTemplates(loadCustomTemplates());
  }, []);

  const wordCount = transcribeRunner.job?.meta?.captionWordCount;
  const language = transcribeRunner.job?.meta?.captionLanguage;
  const renderBusy = renderRunner.starting || renderRunner.jobActive;
  const renderDone = renderRunner.job?.status === 'done';

  const selectedCustom = selectedKey.startsWith('custom:')
    ? (customTemplates.find((tpl) => `custom:${tpl.id}` === selectedKey) ?? null)
    : null;
  const preset: CaptionPreset = selectedCustom ? DEFAULT_KEY : (selectedKey as CaptionPreset);
  const customStyle: CustomCaptionStyle | null = selectedCustom ? selectedCustom.style : null;

  // The transcribe job's "file" is words.json, not media — pull it in and switch to the editor.
  useEffect(() => {
    const job = transcribeRunner.job;
    if (job?.status !== 'done') return;
    let active = true;
    setParsing(true);
    void api
      .jobResult<TranscribeResult>(job.id)
      .then((result) => {
        if (active) setWords(result.words);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setParsing(false);
      });
    return () => {
      active = false;
    };
  }, [transcribeRunner.job]);

  const onFile = (f: File) => {
    setFile(f);
    setWords(null);
    transcribeRunner.reset();
    renderRunner.reset();
  };

  const onChangeFile = () => {
    setFile(null);
    setWords(null);
    setSelectedKey(DEFAULT_KEY);
    setCreatingTemplate(false);
    setPositionX(CAPTION_POSITION_DEFAULT);
    setPositionY(CAPTION_POSITION_Y_DEFAULT);
    setScale(CAPTION_SCALE_DEFAULT);
    transcribeRunner.reset();
    renderRunner.reset();
  };

  const onTranscribe = () => {
    if (!file) return;
    setWords(null);
    const form = new FormData();
    form.append('file', file);
    void transcribeRunner.start('/api/video/captions/transcribe', form);
  };

  const onGenerate = () => {
    if (!file || !words || words.length === 0) return;
    const form = new FormData();
    form.append('words', JSON.stringify(words));
    form.append('preset', preset);
    if (customStyle) form.append('customStyle', JSON.stringify(customStyle));
    form.append('positionX', String(positionX));
    form.append('positionY', String(positionY));
    form.append('scale', String(scale));
    form.append('file', file);
    void renderRunner.start('/api/video/captions/render', form);
  };

  const onSaveTemplate = (name: string, style: CustomCaptionStyle) => {
    const next = saveCustomTemplate(name, style);
    setCustomTemplates(next);
    setSelectedKey(`custom:${next[next.length - 1].id}`);
    setCreatingTemplate(false);
  };

  const onDeleteTemplate = (id: string) => {
    const next = deleteCustomTemplate(id);
    setCustomTemplates(next);
    if (selectedKey === `custom:${id}`) setSelectedKey(DEFAULT_KEY);
  };

  const updateWord = (index: number, patch: Partial<CaptionWord>) => {
    setWords((prev) => (prev ? prev.map((w, i) => (i === index ? { ...w, ...patch } : w)) : prev));
  };

  const deleteWord = (index: number) => {
    setWords((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  };

  const sampleText = words && words.length > 0 ? words.slice(0, 3).map((w) => w.text).join(' ') : t('samplePlaceholder');

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title={t('title')} description={t('description')} />

      {features && !features.captions ? (
        <DesktopOnlyNotice />
      ) : (
        <>
          {!file && (
            <>
              <Dropzone label={t('dropLabel')} hint={t('dropHint')} accept={ACCEPT} onFile={onFile} />
              <p className="text-xs text-zinc-500">{t('hint')}</p>
            </>
          )}

          {file && (
            <Card className="space-y-4 divide-y divide-white/10">
              <div className="flex items-center justify-between gap-4">
                <p className="min-w-0 truncate text-sm text-zinc-300">
                  {file.name} <span className="text-zinc-500">· {formatBytes(file.size)}</span>
                </p>
                <button
                  type="button"
                  onClick={onChangeFile}
                  disabled={renderBusy}
                  className="shrink-0 cursor-pointer text-sm text-zinc-400 hover:text-zinc-200"
                >
                  {t('changeFile')}
                </button>
              </div>

              {words === null ? (
                <div className="space-y-3">
                  {localUrl && (
                    <video src={localUrl} controls className="max-h-64 w-full rounded-md bg-black" />
                  )}
                  {transcribeRunner.errorCode && (
                    <ErrorMessage>
                      {t(`downloader:errors.${transcribeRunner.errorCode}`, t('downloader:errors.download_failed'))}
                    </ErrorMessage>
                  )}
                  {!transcribeRunner.starting && !transcribeRunner.jobActive && !parsing && (
                    <Button className="w-full" onClick={onTranscribe}>
                      {t('transcribe')}
                    </Button>
                  )}
                  {(transcribeRunner.starting || parsing) && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <Spinner /> {t('transcribing')}
                    </div>
                  )}
                  <JobStatus starting={false} job={transcribeRunner.job} onCancel={transcribeRunner.cancel} preview={false} />
                </div>
              ) : (
                <>
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('templateTitle')}</p>
                    {creatingTemplate ? (
                      <CustomTemplateEditor onSave={onSaveTemplate} onCancel={() => setCreatingTemplate(false)} />
                    ) : (
                      <TemplateGallery
                        customTemplates={customTemplates}
                        selectedKey={selectedKey}
                        onSelect={setSelectedKey}
                        onCreateNew={() => setCreatingTemplate(true)}
                        onDeleteCustom={onDeleteTemplate}
                        disabled={renderBusy}
                        label={(p) => t(`preset.${p}`)}
                      />
                    )}
                  </div>

                  {localUrl && !renderDone && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('positionTitle')}</p>
                      <CaptionFrame
                        videoUrl={localUrl}
                        positionX={positionX}
                        positionY={positionY}
                        scale={scale}
                        onPositionChange={(x, y) => {
                          setPositionX(x);
                          setPositionY(y);
                        }}
                        onScaleChange={setScale}
                        sampleText={sampleText}
                        disabled={renderBusy}
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('editTitle')}</p>
                      <p className="text-xs text-zinc-500">
                        {t('wordsFound', { count: wordCount ?? words.length })}
                        {language && ` · ${t('languageDetected', { language })}`}
                      </p>
                    </div>
                    <p className="text-xs text-zinc-500">{t('editHint')}</p>
                    <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-zinc-800 p-2">
                      {words.map((word, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={word.text}
                            onChange={(e) => updateWord(i, { text: e.target.value })}
                            disabled={renderBusy}
                            className="h-8 min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 focus:border-accent focus:outline-none disabled:opacity-50"
                          />
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={word.start}
                            onChange={(e) => updateWord(i, { start: Number(e.target.value) })}
                            disabled={renderBusy}
                            className="h-8 w-16 rounded border border-zinc-700 bg-zinc-900 px-1 text-right text-xs text-zinc-100 focus:border-accent focus:outline-none disabled:opacity-50"
                          />
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={word.end}
                            onChange={(e) => updateWord(i, { end: Number(e.target.value) })}
                            disabled={renderBusy}
                            className="h-8 w-16 rounded border border-zinc-700 bg-zinc-900 px-1 text-right text-xs text-zinc-100 focus:border-accent focus:outline-none disabled:opacity-50"
                          />
                          <button
                            type="button"
                            onClick={() => deleteWord(i)}
                            disabled={renderBusy}
                            aria-label={t('deleteWord')}
                            className="shrink-0 cursor-pointer text-zinc-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {renderRunner.errorCode && (
                    <ErrorMessage>
                      {t(`downloader:errors.${renderRunner.errorCode}`, t('downloader:errors.download_failed'))}
                    </ErrorMessage>
                  )}

                  {!renderBusy && !renderDone && (
                    <Button className="w-full" onClick={onGenerate} disabled={words.length === 0}>
                      {t('generate')}
                    </Button>
                  )}
                  {renderRunner.starting && (
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <Spinner /> {t('uploading')}
                    </div>
                  )}

                  <JobStatus
                    starting={false}
                    job={renderRunner.job}
                    onCancel={renderRunner.cancel}
                    preview
                    doneNote={
                      wordCount !== undefined && wordCount < 3 ? (
                        <p className="text-sm text-amber-300">{t('fewWordsWarning')}</p>
                      ) : undefined
                    }
                    doneActions={
                      <Button variant="secondary" onClick={onGenerate}>
                        {t('generateAgain')}
                      </Button>
                    }
                  />
                </>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
