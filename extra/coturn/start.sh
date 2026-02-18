#!/bin/sh
set -eu

PUBLIC_IP="${TURN_EXTERNAL_IP:-$(curl -s https://api.ipify.org || echo '')}"
TURN_USER="${TURN_USER:-disclone}"
TURN_PASS="${TURN_PASS:-superGhost598!}"
REALM="${TURN_REALM:-datapulsecorp.com}"

# Relay port range from Cloudron-assigned RELAY_UDP_PORT (100 ports)
MIN_RELAY="${RELAY_UDP_PORT:-49152}"
MAX_RELAY=$((MIN_RELAY + 99))

echo "Starting coturn..."
echo "  Public IP: ${PUBLIC_IP}"
echo "  TURN port: ${TURN_PORT:-3478} (TCP) / ${TURN_UDP_PORT:-3478} (UDP)"
echo "  Relay range: ${MIN_RELAY}-${MAX_RELAY}"
echo "  User: ${TURN_USER}"

exec turnserver \
  -n \
  --log-file=stdout \
  --listening-port="${TURN_UDP_PORT:-3478}" \
  --min-port="${MIN_RELAY}" \
  --max-port="${MAX_RELAY}" \
  --realm="${REALM}" \
  --lt-cred-mech \
  --user="${TURN_USER}:${TURN_PASS}" \
  --external-ip="${PUBLIC_IP}" \
  --no-cli \
  --fingerprint \
  --no-tls \
  --no-dtls
