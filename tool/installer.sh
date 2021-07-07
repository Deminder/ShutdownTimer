#!/bin/bash

# installer.sh - This script installs a policykit action for the Shutdown Timer gnome-shell extension.
#
# This file is part of the gnome-shell extension ShutdownTimer@Deminder.

# Authors: Martin Koppehel <psl.kontakt@gmail.com>, Fin Christensen <christensen.fin@gmail.com> (cpupower extension)

set -e

################################
# EXTENSION SPECIFIC OPTIONS:  #
################################

EXTENSION_NAME="Shutdown Timer"
ACTION_BASE="dem.shutdowntimer"
RULE_BASE="$ACTION_BASE.settimers"
CFC_BASE="shutdowntimerctl"
RPM_BUILD_CONTAINERFILE="rpmbuild_Containerfile"
POLKIT_DIR="polkit"
VERSION=1


EXIT_SUCCESS=0
EXIT_INVALID_ARG=1
EXIT_FAILED=2
EXIT_NEEDS_UPDATE=3
EXIT_NEEDS_SECURITY_UPDATE=4
EXIT_NOT_INSTALLED=5
EXIT_MUST_BE_ROOT=6

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )" #stackoverflow 59895
PREFIX="/usr" # default install prefix is /usr

function check_support() {
    if [ -f /sys/class/rtc/rtc0/wakealarm ]
    then
        echo "Supported"
        exit ${EXIT_SUCCESS}
    else
        echo "Unsupported"
        exit ${EXIT_FAILED}
    fi
}

function fail() {
    echo "Failed${1}" >&2 && exit ${EXIT_FAILED}
}



########################
# GENERALIZED SCRIPT:  #
########################

function usage() {
    echo "Usage: installer.sh [options] {supported,install,check,update,uninstall}"
    echo
    echo "Available options:"
    echo "  --prefix PREFIX        Set the install prefix (default: /usr)"
    echo "  --tool-suffix SUFFIX   Set the tool name suffix (default: <empty>)"
    echo
    exit ${EXIT_INVALID_ARG}
}

if [ $# -lt 1 ]
then
    usage
fi

ACTION=""
while [[ $# -gt 0 ]]
do
    key="$1"

    # we have to use command line arguments here as pkexec does not support
    # setting environment variables
    case $key in
        --prefix)
            PREFIX="$2"
            shift
            shift
            ;;
        --tool-suffix)
            TOOL_SUFFIX="$2"
            shift
            shift
            ;;
        supported|install|check|update|uninstall)
            if [ -z "$ACTION" ]
            then
                ACTION="$1"
            else
                echo "Too many actions specified. Please give at most 1."
                usage
            fi
            shift
            ;;
        *)
            echo "Unknown argument $key"
            usage
            ;;
    esac
done


ACTION_IN="${DIR}/../${POLKIT_DIR}/$ACTION_BASE.policy.in"
ACTION_DIR="${PREFIX}/share/polkit-1/actions"
RULE_IN="${DIR}/../${POLKIT_DIR}/10-$RULE_BASE.rules"
RULE_DIR="${PREFIX}/share/polkit-1/rules.d"
RULE_OUT="${RULE_DIR}/10-$RULE_BASE.rules"
CFC_IN="${DIR}/$CFC_BASE"

function print_policy_xml() {
    sed -e "s:{{PATH}}:${CFC_OUT}:g" \
        -e "s:{{ACTION_BASE}}:${ACTION_BASE}:g" \
        -e "s:{{ACTION_ID}}:${ACTION_ID}:g" "${ACTION_IN}"
}

function print_rules_javascript() {
    sed -e "s:{{RULE_BASE}}:${RULE_BASE}:g" "${RULE_IN}"
}

# if TOOL_SUFFIX is provided, install to .../local/bin
# see https://github.com/martin31821/cpupower/issues/102
# the TOOL_SUFFIX enables per-user installations on a multi-user system
# see https://github.com/martin31821/cpupower/issues/84

# use no suffix by default: system wide install
CFC_DIR="${PREFIX}/bin"
CFC_OUT="${CFC_DIR}/$CFC_BASE"
ACTION_ID="$RULE_BASE"
if [ ! -z "${TOOL_SUFFIX}" ]; then
    # use suffix: local install
    if [[ "$PREFIX" != *local ]]; then
        CFC_DIR="${PREFIX}/local/bin"
    fi
    CFC_OUT="${CFC_OUT}-${TOOL_SUFFIX}"
    ACTION_ID="${ACTION_ID}.${TOOL_SUFFIX}"
fi
ACTION_OUT="${ACTION_DIR}/${ACTION_ID}.policy"

if [ "$ACTION" = "supported" ]
then
    check_support
fi

if [ "$ACTION" = "check" ]
then
    if ! print_policy_xml | cmp --silent "${ACTION_OUT}"
    then
        if [ -f "${ACTION_OUT}" ]
        then
            echo "Your $EXTENSION_NAME installation needs updating!"
            exit ${EXIT_NEEDS_UPDATE}
        else
            echo "Not installed"
            exit ${EXIT_NOT_INSTALLED}
        fi
    fi
    echo "Installed"

    exit ${EXIT_SUCCESS}
fi

# used for rpm-ostree install / uninstall
TOOL_NAME=$(basename ${CFC_OUT})
PACKAGE_NAME="${TOOL_NAME}-tool"
RELEASE=local
VPKG_NAME="${PACKAGE_NAME}-${VERSION}"
DIST_PKG_NAME=${VPKG_NAME}-${RELEASE}.noarch

if [ "$ACTION" = "install" ]
then
    if [[ "$PREFIX" == '/usr' ]] && which rpm-ostree >/dev/null; then
        # install must be an rpm package (rpm-ostree may run without root)
        which podman >/dev/null || fail " - podman required to build package"

        TEMP_DIR=$(mktemp -d)
        [ -d "$TEMP_DIR" ] || fail " - creating temporary directory"
        trap "rm -rf $TEMP_DIR" EXIT
        ACTION_NAME=$(basename ${ACTION_OUT})
        RULE_NAME=$(basename ${RULE_OUT})

        echo "Building package ${VPKG_NAME}..."
        SOURCES_DIR="${TEMP_DIR}/${VPKG_NAME}"
        mkdir -p "${SOURCES_DIR}"
        cp "${CFC_IN}" "${SOURCES_DIR}/${TOOL_NAME}" || fail

        echo "Copying policykit action... "
        print_policy_xml > "${SOURCES_DIR}/${ACTION_NAME}" 2>/dev/null || fail

        echo "Copying policykit rule... "
        print_rules_javascript > "${SOURCES_DIR}/${RULE_NAME}" 2>/dev/null || fail

        echo "Copying Containerfile... "
        cp "${DIR}/${RPM_BUILD_CONTAINERFILE}" "${TEMP_DIR}/Containerfile" || fail

        SOURCES_BASE="$(basename ${SOURCES_DIR})"
        echo "Bundling sources ${SOURCES_DIR}..."

        cd "${TEMP_DIR}" || fail
        TARFILE="${SOURCES_BASE}.tar.gz"
        tar zcvf "$TARFILE" "${SOURCES_BASE}" >/dev/null || fail

        SPECFILE="${VPKG_NAME}.spec"
        cat > "$SPECFILE" << EOF
Name:           ${PACKAGE_NAME}
Version:        ${VERSION}
Release:        ${RELEASE}
Summary:        Tool and polkit configuration for the ShutdownTimer@deminder gnome-shell-extension
BuildArch:      noarch

License:        GPLv3
URL:            https://github.com/Deminder/ShutdownTimer
Source0:        %{name}-%{version}.tar.gz

#BuildRequires:
Requires:       bash

%description
The tool is a bash script which allows control of the shutdown schedule and the rtc wake alarm. The polkit action ${ACTION_ID} is added.

%prep
%setup -q

%build

%install
mkdir -p "%{buildroot}%{_bindir}"
install "${TOOL_NAME}" "%{buildroot}%{_bindir}"
mkdir -p "%{buildroot}%{_datadir}/polkit-1/actions"
install -m 0644 "${ACTION_NAME}" "%{buildroot}%{_datadir}/polkit-1/actions"
mkdir -p "%{buildroot}%{_datadir}/polkit-1/rules.d"
install -m 0644 "${RULE_NAME}" "%{buildroot}%{_datadir}/polkit-1/rules.d"

%clean
rm -rf %{bulidroot}

%files
%{_bindir}/${TOOL_NAME}
%{_datadir}/polkit-1/actions/${ACTION_NAME}
%{_datadir}/polkit-1/rules.d/${RULE_NAME}

%changelog
* $(date +"%a %b %e %Y") Deminder <tremminder@gmail.com>
- Generated by tool/installer.sh
EOF
        IMAGE_TAG=${PACKAGE_NAME}-builder
        echo "Building podman image for rpmbuild: $IMAGE_TAG... (this may take a minute)"
        podman build --build-arg=TARFILE=$TARFILE --build-arg=SPECFILE=$SPECFILE -t "$IMAGE_TAG" . 2>&1 >/dev/null || fail
        echo "Running rpmbuild for $DIST_PKG_NAME in container..."
        CONATINER_ID=$(podman run -d "localhost/$IMAGE_TAG" --target=noarch -bb "/root/rpmbuild/SPECS/$SPECFILE")
        [[ $(podman container wait "$CONATINER_ID") == 0 ]] || fail " - cause: rpmbuild not successful"
        echo "Copying $DIST_PKG_NAME.rpm from container..."
        podman cp "$CONATINER_ID:/root/rpmbuild/RPMS/noarch/${DIST_PKG_NAME}.rpm" ./ >/dev/null || fail
        echo "Removing container..."
        podman container rm "$CONATINER_ID" >/dev/null
        echo "Removing image..."
        podman image rm "localhost/$IMAGE_TAG" >/dev/null

        echo "Install ${DIST_PKG_NAME}.rpm with rpm-ostree..."
        rpm-ostree install "${DIST_PKG_NAME}.rpm" >/dev/null || fail
        echo "Success: "$DIST_PKG_NAME" installed"
        echo "Restart required for changes to take effect." >&2
        exit ${EXIT_SUCCESS}
    fi
    if [ "${EUID}" -ne 0 ]; then
        echo "The install action must be run as root for security reasons!"
        echo "Please have a look at https://github.com/martin31821/cpupower/issues/102"
        echo "for further details."
        exit ${EXIT_MUST_BE_ROOT}
    fi

    echo -n "Installing ${TOOL_NAME}) tool... "
    mkdir -p "${CFC_DIR}"
    install "${CFC_IN}" "${CFC_OUT}" || fail
    echo "Success"

    echo -n "Installing policykit action... "
    mkdir -p "${ACTION_DIR}"
    (print_policy_xml > "${ACTION_OUT}" 2>/dev/null && chmod 0644 "${ACTION_OUT}") || fail
    echo "Success"

    echo -n "Installing policykit rule... "
    mkdir -p "${RULE_DIR}"
    (print_rules_javascript > "${RULE_OUT}" 2>/dev/null && chmod 0644 "${RULE_OUT}")  || fail
    echo "Success"

    exit ${EXIT_SUCCESS}
fi

if [ "$ACTION" = "update" ]
then
    "${BASH_SOURCE[0]}" --prefix "${PREFIX}" --tool-suffix "${TOOL_SUFFIX}" uninstall || exit $?
    "${BASH_SOURCE[0]}" --prefix "${PREFIX}" --tool-suffix "${TOOL_SUFFIX}" install || exit $?

    exit ${EXIT_SUCCESS}
fi

if [ "$ACTION" = "uninstall" ]
then
    if [[ "$PREFIX" == '/usr' ]] && which rpm-ostree >/dev/null; then
        rpm-ostree uninstall "$DIST_PKG_NAME" >/dev/null || fail
        echo "Success: "$DIST_PKG_NAME" uninstalled"
        echo "Restart required for changes to take effect." >&2
        exit ${EXIT_SUCCESS}
    fi
    echo -n "Uninstalling $(basename $CFC_OUT) tool... "
    if [ -f "${CFC_OUT}" ]
    then
        rm "${CFC_OUT}" || fail " - cannot remove ${CFC_OUT}" && echo "Success"
    else
        echo "tool not installed at ${CFC_OUT}"
    fi

    echo -n "Uninstalling policykit action... "
    if [ -f "${ACTION_OUT}" ]
    then
        rm "${ACTION_OUT}" || fail " - cannot remove ${ACTION_OUT}" && echo "Success"
    else
        echo "policy action not installed at ${ACTION_OUT}"
    fi

    echo -n "Uninstalling policykit rule... "
    if [ -f "${RULE_OUT}" ]
    then
        rm "${RULE_OUT}" || fail " - cannot remove ${RULE_OUT}" && echo "Success"
    else
        echo "policy rule not installed at ${RULE_OUT}"
    fi

    exit ${EXIT_SUCCESS}
fi

echo "Unknown parameter."
usage 


