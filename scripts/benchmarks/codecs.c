// Local benchmark worker. Length-prefixed input stays in memory; stdout is aggregate JSON.
// Native libraries are benchmarked directly, not Node addon or HTTP performance.
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <zlib.h>
#include <zstd.h>
#include <lz4frame.h>
#include <lz4.h>

#define CODECS 6
#define ROUNDS 3
typedef struct { unsigned long long input, output, count; double enc[ROUNDS], dec[ROUNDS]; } Stats;
static Stats stats[2][CODECS];
static const char *names[] = {"gzip-1", "gzip-6", "zstd-1", "zstd-3", "lz4-fast", "lz4-hc-9"};
static void fail(void) { fputs("Codec benchmark failed\n", stderr); exit(1); }
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }
static uint32_t le32(const unsigned char *p) { return p[0] | (uint32_t)p[1]<<8 | (uint32_t)p[2]<<16 | (uint32_t)p[3]<<24; }
static size_t encode(int codec, void *out, size_t cap, const void *in, size_t size) {
  if (codec < 2) {
    z_stream z = {0};
    if (deflateInit2(&z, codec == 0 ? 1 : 6, Z_DEFLATED, 31, 8, Z_DEFAULT_STRATEGY) != Z_OK) fail();
    z.next_in = (Bytef *)in; z.avail_in = (uInt)size; z.next_out = out; z.avail_out = (uInt)cap;
    if (deflate(&z, Z_FINISH) != Z_STREAM_END) fail();
    size_t n = z.total_out; deflateEnd(&z); return n;
  }
  if (codec < 4) {
    size_t n = ZSTD_compress(out, cap, in, size, codec == 2 ? 1 : 3);
    if (ZSTD_isError(n)) fail(); return n;
  }
  LZ4F_preferences_t prefs = {0};
  prefs.compressionLevel = codec == 4 ? 0 : 9;
  prefs.frameInfo.contentSize = size;
  size_t n = LZ4F_compressFrame(out, cap, in, size, &prefs);
  if (LZ4F_isError(n)) fail(); return n;
}
static size_t decode(int codec, void *out, size_t cap, const void *in, size_t size) {
  if (codec < 2) {
    z_stream z = {0}; if (inflateInit2(&z, 31) != Z_OK) fail();
    z.next_in = (Bytef *)in; z.avail_in = (uInt)size; z.next_out = out; z.avail_out = (uInt)cap;
    if (inflate(&z, Z_FINISH) != Z_STREAM_END || z.total_in != size) fail();
    size_t n = z.total_out; inflateEnd(&z); return n;
  }
  if (codec < 4) {
    size_t n = ZSTD_decompress(out, cap, in, size); if (ZSTD_isError(n)) fail(); return n;
  }
  LZ4F_dctx *ctx;
  if (LZ4F_isError(LZ4F_createDecompressionContext(&ctx, LZ4F_VERSION))) fail();
  size_t consumed = 0, written = 0, hint;
  do {
    size_t a = cap-written, b = size-consumed;
    hint = LZ4F_decompress(ctx, (char *)out+written, &a, (char *)in+consumed, &b, NULL);
    if (LZ4F_isError(hint) || (hint && !a && !b)) fail();
    consumed += b; written += a;
  } while (hint);
  LZ4F_freeDecompressionContext(ctx);
  if (consumed != size) fail(); return written;
}
static double median(double *a) {
  double x=a[0], y=a[1], z=a[2];
  return x>y ? (y>z ? y : (x>z ? z:x)) : (x>z ? x : (y>z ? z:y));
}
int main(void) {
  unsigned char header[8];
  while (1) {
    size_t n = fread(header, 1, 8, stdin); if (!n) break; if (n != 8) fail();
    uint32_t kind=le32(header), size=le32(header+4);
    if (kind > 1 || !size || size > 1048576) fail();
    size_t cap=size*2+65536;
    char *in=malloc(size), *out=malloc(cap), *restored=malloc(size);
    if (!in || !out || !restored || fread(in, 1, size, stdin) != size) fail();
    for (int c=0; c<CODECS; c++) {
      size_t encoded=0;
      for (int r=-1; r<ROUNDS; r++) { // one warm-up, then three measured rounds per batch
        double start=now(); encoded=encode(c,out,cap,in,size); double middle=now();
        size_t decoded=decode(c,restored,size,out,encoded); double end=now();
        if (decoded != size || memcmp(in,restored,size)) fail();
        if (r>=0) { stats[kind][c].enc[r]+=middle-start; stats[kind][c].dec[r]+=end-middle; }
      }
      stats[kind][c].input+=size; stats[kind][c].output+=encoded; stats[kind][c].count++;
    }
    free(in); free(out); free(restored);
  }
  if (ferror(stdin)) fail();
  printf("{\"libraries\":{\"zlib\":\"%s\",\"zstd\":\"%s\",\"lz4\":\"%u\"},\"rounds\":3,\"warmups_per_batch\":1,\"roundtrip\":true,\"results\":[",zlibVersion(),ZSTD_versionString(),LZ4_versionNumber());
  for (int k=0; k<2; k++) for (int c=0; c<CODECS; c++) {
    Stats *s=&stats[k][c];
    printf("%s{\"stage\":\"%s\",\"codec\":\"%s\",\"batches\":%llu,\"input_bytes\":%llu,\"output_bytes\":%llu,\"encode_seconds\":%.6f,\"decode_seconds\":%.6f}",k||c?",":"",k?"server_masked":"collector",names[c],s->count,s->input,s->output,median(s->enc),median(s->dec));
  }
  puts("]}"); return 0;
}
