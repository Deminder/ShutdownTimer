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
POLKIT_DIR="polkit"


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
if [ -z "${TOOL_SUFFIX}" ]
then
    CFC_DIR="${PREFIX}/bin"
    CFC_OUT="${CFC_DIR}/$CFC_BASE"
    ACTION_ID="$RULE_BASE"
    ACTION_OUT="${ACTION_DIR}/${ACTION_ID}.policy"
else
    CFC_DIR="${PREFIX}/local/bin"
    CFC_OUT="${CFC_DIR}/$CFC_BASE-${TOOL_SUFFIX}"
    ACTION_ID="$RULE_BASE.${TOOL_SUFFIX}"
    ACTION_OUT="${ACTION_DIR}/${ACTION_ID}.policy"
fi

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

if [ "$ACTION" = "install" ]
then
    if [ "${EUID}" -ne 0 ]; then
        echo "The install action must be run as root for security reasons!"
        echo "Please have a look at https://github.com/martin31821/cpupower/issues/102"
        echo "for further details."
        exit ${EXIT_MUST_BE_ROOT}
    fi

    echo -n "Installing $(basename ${CFC_OUT}) tool... "
   mkdir -p "${CFC_DIR}"
    install "${CFC_IN}" "${CFC_OUT}" || (echo "Failed" && exit ${EXIT_FAILED})
    echo "Success"

    echo -n "Installing policykit action... "
    mkdir -p "${ACTION_DIR}"
    print_policy_xml > "${ACTION_OUT}" 2>/dev/null || \
        (echo "Failed" && exit ${EXIT_FAILED})
    echo "Success"

    echo -n "Installing policykit rule... "
    mkdir -p "${RULE_DIR}"
    (print_rules_javascript > "${RULE_OUT}" && chmod 0644 "${RULE_IN}")  || (echo "Failed" && exit ${EXIT_FAILED})
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
    echo -n "Uninstalling $(basename $CFC_OUT) tool... "
    if [ -f "${CFC_OUT}" ]
    then
        rm "${CFC_OUT}" || (echo "Failed - cannot remove ${CFC_OUT}" && exit ${EXIT_FAILED}) && echo "Success"
    else
        echo "tool not installed at ${CFC_OUT}"
    fi

    echo -n "Uninstalling policykit action... "
    if [ -f "${ACTION_OUT}" ]
    then
        rm "${ACTION_OUT}" || (echo "Failed - cannot remove ${ACTION_OUT}" && exit ${EXIT_FAILED}) && echo "Success"
    else
        echo "policy action not installed at ${ACTION_OUT}"
    fi

    echo -n "Uninstalling policykit rule... "
    if [ -f "${RULE_OUT}" ]
    then
        rm "${RULE_OUT}" || (echo "Failed - cannot remove ${RULE_OUT}" && exit ${EXIT_FAILED}) && echo "Success"
    else
        echo "policy rule not installed at ${RULE_OUT}"
    fi

    exit ${EXIT_SUCCESS}
fi

echo "Unknown parameter."
usage 


