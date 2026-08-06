// ImbatranimOS kiosk-ISO build driver.
//
//   Bootstrap once:   cc -o build build.c
//   Build the ISO:    ./build iso      (default target)
//   Clean outputs:    ./build clean
//
// `iso` ensures the web app is built (turbo), builds the Alpine toolbox image,
// then runs the whole mkimage pipeline UNPRIVILEGED (fakeroot) inside Docker.
// The finished ISO lands in iso/out/imbatranimos-<version>-x86_64.iso.
//
// nob rebuilds this driver automatically when build.c changes.
#define NOB_IMPLEMENTATION
#include "nob.h"

#include <string.h>
#include <unistd.h>
#include <libgen.h>

#define IMAGE_TAG "imbatranim-iso-build"
#define ISO_VERSION "1.0.0"

// Absolute path of the iso/ dir (this file's dir == cwd when run as ./build).
static char cwd[4096];
static char repo_root[4096];

static const char *p(const char *rel) {
    return nob_temp_sprintf("%s/%s", cwd, rel);
}

static bool export_clean_repo(void) {
    // Export a pristine snapshot of HEAD so the ISO is built from a coherent,
    // committed tree — never from an in-progress working tree (other lanes may
    // be mid-edit under apps/). This also makes `./build iso` reproducible from
    // any checkout: the container builds the whole app from this snapshot.
    const char *clean = p(".cleanrepo");
    nob_log(NOB_INFO, "Exporting clean HEAD snapshot to %s", clean);
    Nob_Cmd cmd = {0};
    nob_cmd_append(&cmd, "sh", "-c",
                   nob_temp_sprintf("rm -rf '%s' && mkdir -p '%s' && "
                                    "cd '%s' && git archive HEAD | tar -x -C '%s'",
                                    clean, clean, repo_root, clean));
    return nob_cmd_run_sync_and_reset(&cmd);
}

static bool build_image(void) {
    nob_log(NOB_INFO, "Building Alpine toolbox image (%s)", IMAGE_TAG);
    Nob_Cmd cmd = {0};
    nob_cmd_append(&cmd, "docker", "build", "-t", IMAGE_TAG, "-f", p("Dockerfile"), cwd);
    return nob_cmd_run_sync_and_reset(&cmd);
}

static bool run_iso(void) {
    if (!nob_mkdir_if_not_exists(p("out"))) return false;
    nob_log(NOB_INFO, "Running mkimage pipeline in Docker (unprivileged)");
    Nob_Cmd cmd = {0};
    nob_cmd_append(&cmd, "docker", "run", "--rm", "--network", "host");
    nob_cmd_append(&cmd, "-e", "ISO_VERSION=" ISO_VERSION);
    nob_cmd_append(&cmd, "-v", nob_temp_sprintf("%s:/repo:ro", p(".cleanrepo")));
    nob_cmd_append(&cmd, "-v", nob_temp_sprintf("%s:/work:ro", p("scripts")));
    nob_cmd_append(&cmd, "-v", nob_temp_sprintf("%s:/out", p("out")));
    nob_cmd_append(&cmd, IMAGE_TAG, "/work/run-mkimage.sh");
    return nob_cmd_run_sync_and_reset(&cmd);
}

static bool target_iso(void) {
    if (!export_clean_repo()) return false;
    if (!build_image()) return false;
    if (!run_iso()) return false;
    nob_log(NOB_INFO, "ISO ready under %s", p("out"));
    return true;
}

static bool target_clean(void) {
    Nob_Cmd cmd = {0};
    nob_cmd_append(&cmd, "rm", "-rf", p("out"), p(".cleanrepo"));
    if (!nob_cmd_run_sync_and_reset(&cmd)) return false;
    nob_cmd_append(&cmd, "docker", "rmi", "-f", IMAGE_TAG);
    nob_cmd_run_sync_and_reset(&cmd); // best-effort
    nob_log(NOB_INFO, "Cleaned");
    return true;
}

int main(int argc, char **argv) {
    NOB_GO_REBUILD_URSELF(argc, argv);

    if (getcwd(cwd, sizeof(cwd)) == NULL) {
        nob_log(NOB_ERROR, "getcwd failed");
        return 1;
    }
    // repo_root = parent of iso/
    strncpy(repo_root, cwd, sizeof(repo_root) - 1);
    char *slash = strrchr(repo_root, '/');
    if (slash) *slash = '\0';

    const char *target = argc > 1 ? argv[1] : "iso";
    if (strcmp(target, "iso") == 0) {
        return target_iso() ? 0 : 1;
    } else if (strcmp(target, "clean") == 0) {
        return target_clean() ? 0 : 1;
    }
    nob_log(NOB_ERROR, "unknown target '%s' (use: iso | clean)", target);
    return 1;
}
