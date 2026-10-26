import { fileDesc, messageDesc, type GenMessage } from '@bufbuild/protobuf/codegenv2';
import { base64Encode }                           from '@bufbuild/protobuf/wire';
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FieldDescriptorProtoSchema,
  FileDescriptorProtoSchema,
  type FieldDescriptorProto,
}                                         from '@bufbuild/protobuf/wkt';
import { create, toBinary, type Message } from '@bufbuild/protobuf';

/*
 * A small protobuf service built from real protobuf-es descriptors, in the shape protoc-gen-es and the service
 * generator emit, so the tests of `wrapService` run against the same kind of schemas a generated service has.
 * `GetThingResponse.size` is an int64: protobuf-es holds it as a bigint, which `JSON.stringify` cannot write.
 */

const PACKAGE = 'things.v1';

function field(name: string, number: number, type: FieldDescriptorProto_Type, label = FieldDescriptorProto_Label.OPTIONAL): FieldDescriptorProto {
  return create(FieldDescriptorProtoSchema, { name, number, type, label });
}

const fileDescriptor = create(FileDescriptorProtoSchema, {
  name:        'things.proto',
  package:     PACKAGE,
  syntax:      'proto3',
  messageType: [
    { name: 'GetThingRequest', field: [field('name', 1, FieldDescriptorProto_Type.STRING)] },
    { name: 'GetThingResponse', field: [field('name', 1, FieldDescriptorProto_Type.STRING), field('size', 2, FieldDescriptorProto_Type.INT64)] },
    { name: 'ListThingsRequest', field: [field('filter', 1, FieldDescriptorProto_Type.STRING)] },
    { name: 'ListThingsResponse', field: [field('names', 1, FieldDescriptorProto_Type.STRING, FieldDescriptorProto_Label.REPEATED)] },
  ],
});

const thingsFile = fileDesc(base64Encode(toBinary(FileDescriptorProtoSchema, fileDescriptor)));

export type GetThingRequest = Message<'things.v1.GetThingRequest'> & { name: string };
export type GetThingResponse = Message<'things.v1.GetThingResponse'> & { name: string; size: bigint };
export type ListThingsRequest = Message<'things.v1.ListThingsRequest'> & { filter: string };
export type ListThingsResponse = Message<'things.v1.ListThingsResponse'> & { names: string[] };

export const GetThingRequestSchema: GenMessage<GetThingRequest>       = messageDesc(thingsFile, 0);
export const GetThingResponseSchema: GenMessage<GetThingResponse>     = messageDesc(thingsFile, 1);
export const ListThingsRequestSchema: GenMessage<ListThingsRequest>   = messageDesc(thingsFile, 2);
export const ListThingsResponseSchema: GenMessage<ListThingsResponse> = messageDesc(thingsFile, 3);

export const ThingServiceRuntime = {
  basePath:    '/things',
  serviceName: 'ThingService',
  methods:     {
    GetThing:   {
      name:           'GetThing',
      handlerName:    'getThing',
      requestSchema:  GetThingRequestSchema,
      responseSchema: GetThingResponseSchema,
    },
    ListThings: {
      name:           'ListThings',
      handlerName:    'listThings',
      requestSchema:  ListThingsRequestSchema,
      responseSchema: ListThingsResponseSchema,
    },
  },
} as const;
